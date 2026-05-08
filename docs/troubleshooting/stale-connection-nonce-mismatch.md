# Stale WS connection — `device nonce mismatch` after idle period

**Reported:** 2026-05-05 against `openclaw-control-mcp@0.4.3`, gateway `2026.4.12`.

## Symptoms

After a successful pairing (`openclaw_device_status` returned `paired: true`), the MCP works fine for a while. After some idle time (no observed exact threshold — anywhere from minutes to a few hours), every gateway-touching tool starts failing with:

```
MCP error -32603: gateway request 'X' failed (attempt 1/4): device nonce mismatch
```

Verified affected calls: `openclaw_health`, `openclaw_models_list`, `openclaw_status`, basically anything routed through the WS client.

`openclaw_device_status` may still report `paired: true` from cached state, hiding the fact that the live connection is dead.

## Root cause (suspected)

The signed connect handshake produces a per-connection nonce that the gateway tracks for the lifetime of that WS. When the connection is silently dropped (network blip, server-side timeout, sleep/wake cycle, OS network reconfig), the client likely either:

- reuses the already-burned nonce when it tries to re-send a request on the broken socket, or
- never opens a fresh socket at all and keeps writing into a half-closed one until the gateway gives up and rejects with `device nonce mismatch`.

The 4-attempt retry visible in the error message goes through the same codepath each attempt, so retrying does not heal it — only a full `openclaw_setup` cycle does (see workaround).

## Workaround

Re-call `openclaw_setup` with the same `gatewayUrl` and `gatewayToken` values. The setup tool's documented behaviour ("After saving, the matching client connection is closed so the next tool call re-handshakes with the new credentials") tears down the dead client. The next `openclaw_*` call opens a fresh WS, signs a new connect frame with a new nonce, and tools work again immediately.

```ts
// In Claude Code chat:
openclaw_setup({ gatewayUrl: "wss://your-gateway", gatewayToken: "<same token>" })
openclaw_models_list()  // works
```

## Suggestions for a permanent fix

In rough order of impact:

### 1. **Recognize `device nonce mismatch` as a transient error**

`src/gateway/client.ts` already has an `isTransientError` helper for the retry/backoff loop. Adding `device nonce mismatch` to its match set would let the existing retry logic take effect — *but* the current retry shape (same socket, same nonce) won't help. The retry path needs to be enriched: on `device nonce mismatch`, **drop the existing client cache entry and re-handshake** before the next attempt.

Concretely, in `client.ts` request method:

```ts
catch (err) {
  if (isNonceMismatchError(err)) {
    // Tear down this socket/client, reset cached nonce, restart handshake.
    await this.reconnect();
    return this.send(method, params);  // single auto-recovery, then propagate
  }
  // existing retry loop for other transient errors
}
```

### 2. **Periodic liveness ping on idle WS**

Send a `health` JSON-RPC call (or a WS-level ping) every N minutes to detect dead connections proactively. The gateway already exposes `health` as a low-cost no-scope method. If the ping fails, drop the cached client so the next user-initiated call reconnects cleanly.

### 3. **Surface the error with an actionable message**

Replace the raw `device nonce mismatch` propagation with something like:

> `Gateway connection went stale (nonce mismatch). Call openclaw_setup again with the same params to force a fresh handshake. See docs/troubleshooting/stale-connection-nonce-mismatch.md.`

Trivial to add and immediately turns user confusion into "ah, run setup again."

## Repro hints

The bug is timing-dependent. To repro deterministically in tests, mock the WS server to:

1. Accept the initial connect frame and reply `hello-ok`.
2. After N seconds (or after K successful requests), close the underlying socket without notifying the client (TCP RST or just stop responding).
3. Drive a second JSON-RPC call from the client and assert it errors with `device nonce mismatch` rather than reconnecting.

Once fix #1 lands, the same harness verifies the auto-recovery: the second call should succeed after one transparent reconnect.
