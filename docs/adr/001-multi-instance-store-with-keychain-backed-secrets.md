# ADR-001 — Multi-instance Store with keychain-backed secrets

**Status:** Accepted
**Date:** 2026-05-09

## Context

The MCP needs to talk to one or more OpenClaw gateways. Each gateway has its own URL + login token. Three forces shaped the design:

1. **Multi-tenant operator workflows** — a single Claude Code session may target a personal gateway one minute and a work gateway the next. Forcing the user to flip a global default before each call doesn't scale.
2. **Secrets at rest** — gateway tokens, the per-device Ed25519 private key, and per-gateway issued device tokens must persist across MCP restarts but should not be readable by other processes that drop in `~/.config`.
3. **Migration without disruption** — early adopters started on a v1 single-config `store.json`. A v2 with multiple instances had to import their data losslessly.

## Decision

`src/gateway/store.ts` (the **Store** class) is the single load-bearing persistence layer. It holds:

- A v2 schema with `configs: Record<instanceName, { gatewayUrl, gatewayToken, gatewayPassword? }>` plus a `defaultInstance` pointer.
- Per-gateway-id `tokens` (sha256(url) → DeviceTokenEntry).
- The local Ed25519 device identity.
- A keychain backend resolution layer (`maybeKeychainBackend`) that tries macOS `security`, then Linux `secret-tool`, falling back to plain JSON (mode 0600). Keychain is **on by default** since 0.5.0; opt-out via `OPENCLAW_USE_KEYCHAIN=0`.
- An auto-migration v1 → v2 on first load.

Secrets are split into the keychain on save **only when the keychain `set` actually succeeded** (post-0.5.0 fix in `safeSet` helper). This avoids the failure mode where a no-op or transient backend drops the only copy of the secret.

## Consequences

**Positive**
- Tools can target any instance per-call via the `instance` arg (see ADR-002).
- New gateways are added with `openclaw_setup({ instance: "X", … })` without disturbing existing ones.
- Secrets are protected by the OS keychain when available.

**Negative**
- The Store is an articulation point: every tool that talks to a gateway transitively depends on it. A bug in `load()` or `save()` cascades. Mitigated by tests and the integrity helpers (`deviceIntegrity()`, `repairDevice()`).
- The keychain abstraction has multiple branches (macOS / libsecret / Noop / injected-for-tests). Adding a new backend means updating `resolveKeychainBackend` + the test fixtures.

**Files anchored** — `src/gateway/store.ts` (top of file, marker `// ADR-001`).

## Alternatives considered

- **Single global config** (pre-0.4 design). Forces a `setup` round-trip every time the user wants a different gateway. Rejected — too much friction for the multi-gateway use case.
- **OS keychain only** (no JSON fallback). Breaks on Windows / WSL / hosts without `secret-tool`. Rejected — the legacy plain-JSON path stays so the package works everywhere.
