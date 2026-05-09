# ADR-004 — `openclaw_introspect` + `openclaw_call` as the escape hatch

**Status:** Accepted
**Date:** 2026-05-09

## Context

The OpenClaw gateway publishes ~128 JSON-RPC methods. They evolve faster than this MCP can keep up — new methods land in gateway releases that this package hasn't wrapped yet. Two needs:

1. **Discoverability** — operators should be able to ask "what does this gateway actually support?" without reading source.
2. **Coverage gap mitigation** — when a method has no typed wrapper, operators should still be able to call it ad-hoc.

The risk: an unconstrained "raw call" tool turns into a footgun (no schema validation, accidental destructive calls).

## Decision

`src/tools/introspect.ts` ships two tools:

- **`openclaw_introspect`** — triggers a connect (if needed), returns the gateway's `methods[]` / `events[]` from the `hello-ok` payload, and computes a coverage report comparing those methods to the typed wrappers in `WRAPPED_METHODS` (`src/tools/wrappedMethods.ts`). Surfaces `unwrappedMethods` (gateway publishes, MCP doesn't wrap) and `wrappedButNotPublished` (MCP wraps, gateway doesn't expose — drift signal).
- **`openclaw_call`** — DESTRUCTIVE escape hatch that takes `{ method: string, params?: object, instance? }` and forwards verbatim. The Zod schema for `params` is `z.record(z.string(), z.unknown())` so strings/arrays/primitives are rejected at the wrapper (post-0.5.0 fix — pre-fix `z.unknown()` let stringified params through and the gateway rejected them with `must be object`).

Both tools accept the per-call `instance` arg (ADR-002).

The escape hatch's description explicitly marks it destructive and tells callers to prefer typed tools when they exist. Claude Code's confirmation gate prompts before each call.

## Consequences

**Positive**
- Drift between gateway capability and MCP coverage is observable — `openclaw_introspect` is the source of truth, not a hand-maintained list.
- New gateway methods are usable from day one via `openclaw_call`, with a clear "this is an escape hatch" UX.
- The `params` Zod tightening prevents the entire class of bugs where the wrapper accepts garbage and the gateway returns `must be object`.

**Negative**
- `introspect.ts` is an articulation point: every coverage check goes through it. But it's a thin file with simple logic and few changes.
- The escape hatch is a permanent invitation to skip writing typed wrappers. Mitigated by the description + `openclaw_introspect`'s `unwrappedMethods` surfacing the gap.
- `WRAPPED_METHODS` is hand-maintained; if a new typed wrapper forgets to add its method here, the coverage report under-counts. Caught at PR time when the `composite-wrapped-method-orphan` mental check is run (currently informal — see future regression-guard work).

**Files anchored** — `src/tools/introspect.ts` (top of file, marker `// ADR-004`).

## Alternatives considered

- **No escape hatch — only typed wrappers**. Rejected — gateway evolves too fast, ships new methods between MCP releases.
- **Auto-generate Zod from `config.schema.lookup`**. Promising but ~1 day of effort, plus brittle to gateway internal changes. Documented as a future option in CHANGELOG; not blocked on.
