# Wrapper schemas desynchronized from gateway API — `config.patch`, `config.get`, `cron.update`

**Reported:** 2026-05-07 against `openclaw-control-mcp@0.4.3`, gateway `2026.4.12`.

## Summary

Multiple typed tool wrappers expose a Zod schema that no longer matches what the gateway accepts. The MCP either refuses the call client-side or forwards a payload the gateway rejects with `INVALID_REQUEST`. Three concrete instances observed during a single Discord migration session — all on the same gateway version.

## Symptoms

### 1) `openclaw_config_patch` rejects valid input

The tool exposes:

```ts
{ path: string, value: unknown }
```

But the gateway expects:

```ts
{ raw: object, baseHash: string }
```

So a natural call:

```json
{ "path": "channels.telegram", "value": { "dmPolicy": "open" } }
```

fails with:

```
gateway request 'config.patch' failed: invalid config.patch params:
  must have required property 'raw';
  at root: unexpected property 'path';
  at root: unexpected property 'value'
```

Workaround: pass `raw` and `baseHash` directly through the wrapper (the underlying Zod schema is `additionalProperties: true`, so extra keys leak through to the gateway):

```json
{ "raw": { "channels": { "telegram": { "dmPolicy": "open" } } }, "baseHash": "<hash from config.get>" }
```

### 2) `openclaw_config_get` advertises a `path` filter the gateway refuses

The tool description says:

> Pass `path` to scope to a sub-section if supported.

But the gateway rejects it:

```
gateway request 'config.get' failed: invalid config.get params: at root: unexpected property 'path'
```

The wrapper still forwards the param. Either the gateway never supported it (description is wrong) or the API was tightened and the wrapper was not updated. Net effect: the documented filter is broken.

### 3) `openclaw_cron_update` wrapper insists on `job`, gateway insists on `jobId` + `patch`

Wrapper Zod schema:

```ts
{
  job: {
    id: string,
    delivery?: {...},
    payload?: {...},
    schedule?: {...},
    enabled?: boolean,
    name?: string,
    deleteAfterRun?: boolean,
  }
}
```

Gateway schema (`anyOf`):

```ts
{ id: string, patch: object }
// OR
{ jobId: string, patch: object }
```

So a call like:

```json
{ "job": { "id": "<uuid>", "delivery": { "channel": "discord", "to": "<chid>", "mode": "announce" } } }
```

is sent verbatim to the gateway and rejected:

```
invalid cron.update params:
  must have required property 'id';
  must have required property 'patch';
  at root: unexpected property 'job';
  must have required property 'jobId';
  must match a schema in anyOf
```

Trying to bypass with `{ jobId, patch }` directly fails the **wrapper's** Zod check (`Required: job`). The wrapper does not accept the gateway's actual schema, and `additionalProperties: false` blocks the workaround that `config.patch` allowed. Net effect: `cron.update` is **unusable through the typed wrapper** until the schema is fixed.

Observed workaround during the session: edit `/data/.openclaw/cron/jobs.json` directly inside the container and restart the gateway to force the cron store to reload (the in-memory cache otherwise keeps the pre-edit values). This is obviously not appropriate for end users.

## Root cause hypothesis

Each of these tools was last updated when the gateway exposed a different surface. The Zod schemas drifted as the gateway tightened its `INVALID_REQUEST` validation across versions. There is no integration test that exercises a real gateway against each typed tool's payload, so silent drift is undetected.

## Fix candidates

Ordered by impact:

1. **Add a CI step that boots a real gateway (e.g. via `ghcr.io/hostinger/hvps-openclaw:latest`) and round-trips one canonical call per tool.** This catches drift the moment it lands rather than after a user reports each instance individually. The 134-tool surface is too wide for hand audits.
2. **Re-derive each wrapper's Zod schema from the gateway's published `config.schema.lookup` / equivalent introspection** at build time, so the wrapper cannot diverge from the API contract.
3. **Short-term — fix the three observed cases:**
   - `config.patch`: replace `path` + `value` with `raw` + `baseHash` (and surface a helper that auto-fetches `baseHash` from the latest `config.get` to relieve the optimistic-locking ergonomics).
   - `config.get`: remove the documented `path` filter or implement it client-side as a post-fetch projection.
   - `cron.update`: rename `job` to `jobId` + flatten the writable fields into `patch`, mirroring the gateway's `{ jobId, patch }` shape. Provide a deprecation alias on `job` for one minor release if backward compat matters.
4. **Document the optimistic-locking flow for `config.patch`** in the README — `baseHash` is non-obvious, and clients that don't fetch it first get a confusing `config base hash required; re-run config.get and retry` error.

## How to reproduce

```bash
# config.patch — wrapper schema mismatch
mcp call openclaw_config_patch '{"path":"channels.telegram","value":{"dmPolicy":"open"}}'
# → gateway rejects: unexpected property 'path'

# config.get — path filter dead
mcp call openclaw_config_get '{"path":"channels"}'
# → gateway rejects: unexpected property 'path'

# cron.update — total stalemate
mcp call openclaw_cron_update '{"job":{"id":"<uuid>","delivery":{"channel":"discord","to":"<chid>","mode":"announce"}}}'
# → gateway rejects: unexpected property 'job'; must have required 'jobId' or 'id'
mcp call openclaw_cron_update '{"jobId":"<uuid>","patch":{"delivery":{"channel":"discord","to":"<chid>","mode":"announce"}}}'
# → wrapper rejects: Required: job
```
