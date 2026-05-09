# ADR-003 — Single-process shim with per-instance client cache

**Status:** Accepted
**Date:** 2026-05-09

## Context

The MCP runs as one Node process, but it must:

1. Talk to N gateways (one per configured instance) concurrently.
2. Maintain WebSocket lifecycle per gateway (connect handshake, signed nonce, device token).
3. Honour env-var overrides (`OPENCLAW_GATEWAY_URL`/`TOKEN`) that bypass the persisted store entirely.
4. Survive `openclaw_setup` config changes mid-session — the new credentials must take effect on the next call without restarting Claude Code.
5. Optionally expose itself over HTTP (`OPENCLAW_HTTP=1`) instead of stdio.
6. Optionally answer everything from an in-memory mock (`OPENCLAW_MOCK=1`).

## Decision

`src/index.ts` is the entrypoint and the **shim**. It owns:

- A `Map<string, GatewayClient>` cache keyed by instance name (or `__env__` for the env-var override path).
- `ensureClient(instance?)` — async resolver that returns the cached `GatewayClient` (creating one if absent), with env-var override winning over any explicit `instance` arg.
- `reconfigure(instance?)` — closes a cached client (or all of them) so the next call re-handshakes with fresh credentials. Wired into `openclaw_setup` / `openclaw_setup_clear` / `openclaw_setup_select_default`.
- The `clientShim: ToolClient` (see ADR-002) that every tool talks to. Routes per-call `opts.instance` through `ensureClient`.
- A mock branch — when `OPENCLAW_MOCK=1`, `clientShim.request` short-circuits to `MockGateway.request` and the sync getters return canned values, so `--health` and downstream tools don't crash.
- Transport selection — stdio by default, Streamable HTTP when `--http` / `OPENCLAW_HTTP=1`.

## Consequences

**Positive**
- One process, N gateways, no extra resource cost beyond the per-instance WS sockets actually opened.
- Cache invalidation is explicit and local to `reconfigure()` — no spooky action at a distance.
- Mock mode requires zero changes to tool wrappers — the swap happens at the shim layer.

**Negative**
- The shim is an articulation point: every tool call passes through it. A bug in `ensureClient` cascades. Mitigated by unit tests on the routing logic + the `--health` smoke test.
- The cache lives in module scope — testing the shim itself requires module-isolation tricks. So far we test downstream (tool calls) instead.
- Env-var override semantics ("env always wins, even when `instance` is explicit") is non-obvious and documented in the README + setup tool descriptions. A user could be surprised that their `instance: "work"` arg gets ignored when env vars are set.

**Files anchored** — `src/index.ts` (top of file, marker `// ADR-003`).

## Alternatives considered

- **Spawn one MCP child process per gateway**. Rejected — heavyweight, breaks HTTP-mode (each child needs its own port), complicates pairing flow.
- **Move the cache into the Store class**. Rejected — the Store handles persistence, not live WS state. Mixing them couples two concerns that change at different rates.
