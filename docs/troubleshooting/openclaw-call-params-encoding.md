# `openclaw_call` mis-encodes `params` — gateway sees `must be object`

**Reported:** 2026-05-07 against `openclaw-control-mcp@0.4.3`, gateway `2026.4.12`.

## Symptoms

`openclaw_call` is documented as the escape hatch for raw JSON-RPC methods that don't have a typed wrapper yet:

> DESTRUCTIVE ESCAPE HATCH — call ANY JSON-RPC method on the gateway with arbitrary params.

In practice every real call fails because the params don't reach the gateway in the expected shape. Examples observed during the same session:

```json
// Call:
{
  "method": "cron.update",
  "params": { "jobId": "<uuid>", "patch": { "delivery": { "channel": "discord", "to": "<chid>", "mode": "announce" } } }
}

// Gateway response:
gateway request 'cron.update' failed: invalid cron.update params: must be object; must match a schema in anyOf
```

```json
// Call:
{
  "method": "cron.list",
  "params": {}
}

// Gateway response:
gateway request 'cron.list' failed: invalid cron.list params: must be object
```

The `must be object` clue is decisive: the gateway is not seeing the JSON object we sent — it's seeing something else (probably a string, possibly the JSON-stringified version of the object). The original `params: {}` test case is especially diagnostic: an empty object should always satisfy `must be object`, so the wrapper is mis-serializing on the way out.

## Impact

The escape hatch is only useful for read-only methods that take no params (`gateway.identity.get`, `health`, `agent.identity.get`, …). Anything that requires structured params is unreachable through `openclaw_call`. Combined with the wrapper schema mismatches in [`wrapper-schema-mismatch.md`](./wrapper-schema-mismatch.md), there is currently **no path** to call `cron.update` from this MCP — neither the typed wrapper nor the raw escape hatch works.

## Root cause hypothesis

The tool's input schema declares `params` without a type (`description: "Method params"`). The forwarding code likely passes whatever shape it receives — and somewhere between the Zod validation, the request encoder, and the WebSocket frame, the params are being stringified or coerced. Possible suspects:

1. The handler does `JSON.stringify(params)` and passes the string as a JSON-RPC `params` field, which the gateway then sees as a string instead of an object.
2. The Zod schema for `params` falls back to `z.any()` and the runtime conversion doesn't preserve the object shape.
3. An intermediate `encodeParams` or similar helper is wrapping `params` in another envelope (e.g. `{ value: params }` or `{ raw: params }`).

The fix likely lives in the same file as the `passthroughHandler` mentioned in the 0.5.0 changelog (`src/tools/client.ts`).

## Fix candidates

1. **Forward `params` verbatim as a JSON object**, not as a string. Add a unit test that issues `openclaw_call({ method: "cron.list", params: {} })` against a fixture gateway and asserts the gateway sees `{}` not `"{}"`.
2. **Strengthen the Zod schema** for `params` from "any" to `z.object(z.any())` so the type is enforced before the call leaves the MCP.
3. **Add a per-call introspection layer** that runs `openclaw_introspect` once and caches the gateway's per-method schema, so `openclaw_call` can validate `params` against the *gateway's* schema before sending. Optional but would catch malformed escape-hatch calls early with a clear error rather than the cryptic `must be object`.

## How to reproduce

```bash
mcp call openclaw_call '{"method":"cron.list","params":{}}'
# → gateway request 'cron.list' failed: invalid cron.list params: must be object

mcp call openclaw_call '{"method":"health","params":null}'
# → may succeed because health takes no params

mcp call openclaw_call '{"method":"cron.update","params":{"jobId":"<any>","patch":{"enabled":true}}}'
# → gateway request 'cron.update' failed: invalid cron.update params: must be object; must match a schema in anyOf
```

## Related

- [`wrapper-schema-mismatch.md`](./wrapper-schema-mismatch.md) — typed wrappers also broken for `cron.update`, leaving no functional path.
