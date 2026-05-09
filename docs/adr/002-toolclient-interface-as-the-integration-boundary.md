# ADR-002 — `ToolClient` interface as the integration boundary

**Status:** Accepted
**Date:** 2026-05-09

## Context

Pre-0.5.0, every tool builder (`buildCronTools`, `buildSessionsTools`, …) imported the concrete `GatewayClient` class. The shim in `index.ts` faked an instance of `GatewayClient` via `as unknown as GatewayClient` to route calls. This had two problems:

1. **No per-call routing** — the shim was a singleton. Targeting a non-default gateway required `setup_select_default`, killing concurrency.
2. **Type lie** — `as unknown as GatewayClient` bypassed type checks. Adding a new public method to `GatewayClient` would silently leak to all 134 tool wrappers.

## Decision

`src/tools/client.ts` defines a **`ToolClient` interface** that every tool builder accepts:

```ts
interface ToolClient {
  request<T>(method: string, params?: unknown, opts?: { instance?: string }): Promise<T>;
  connect(opts?: { instance?: string }): Promise<unknown>;
  // … sync getters: getDevice, getLastHello, getPairingPending, …
}
```

The `index.ts` shim implements `ToolClient` directly (no more type lie). Each method consumes the optional `opts.instance` to route through `ensureClient(instance)`, which resolves the cached `GatewayClient` for that instance (creating one on first use). Helpers `withInstance` and `passthroughHandler` standardize how every tool's Zod schema gets the optional `instance` field and how the handler forwards args.

## Consequences

**Positive**
- Tools speak to a stable interface, not a class. Adding a new transport (HTTP, the WebSocket-but-mocked path) is a question of providing another `ToolClient` impl.
- Per-call routing comes for free — every tool accepts `{ instance: "work" }` since the sweep in 0.5.0.
- Tests use `makeMockClient()` (from `tests/helpers/mock-client.ts`) without spinning up a real `GatewayClient`.

**Negative**
- `ToolClient` is an articulation point: 25+ tool files import it. Refactors that change the interface ripple everywhere. Mitigated by the high test coverage on the wrappers.
- Sync getters (`getDevice`, etc.) are now optionally instance-aware but the shim's `clientForLookup` returns null when the instance hasn't been initialised yet — callers must `connect()` first.

**Files anchored** — `src/tools/client.ts` (top of file, marker `// ADR-002`).

## Alternatives considered

- **Add an `opts` parameter to the real `GatewayClient.request`** that's ignored at the class level. Rejected — adds dead code surface to the production class.
- **Pass `instance` via a special key inside `params`** (e.g. `__instance`). Rejected — pollutes the wire and opens injection-style hazards if a real method ever takes a param literally named `__instance`.
