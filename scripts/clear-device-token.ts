// Clear the persisted device token for the default gateway. The device
// identity (publicKey + privateKey) is kept, so the next connect presents the
// signed handshake without a deviceToken and the gateway can re-issue a fresh
// one — typically without a re-pair approval, because the publicKey is already
// known on the gateway side.
//
// Use after `AUTH_DEVICE_TOKEN_MISMATCH` to recover a stale local state.
//
// Usage: npx tsx scripts/clear-device-token.ts [--instance default]

import { Store } from "../src/gateway/store.js";

async function main() {
  const args = process.argv.slice(2);
  const instIdx = args.indexOf("--instance");
  const instance = instIdx >= 0 ? (args[instIdx + 1] ?? "default") : "default";

  const store = new Store();
  const cfg = await store.loadConfig(instance);
  if (!cfg.gatewayUrl) {
    process.stderr.write(`instance '${instance}' not configured\n`);
    process.exit(1);
  }
  const gatewayId = Store.gatewayId(cfg.gatewayUrl);
  const before = await store.loadToken(gatewayId);
  if (!before) {
    process.stdout.write(`no token to clear for gatewayId=${gatewayId}\n`);
    return;
  }
  await store.clearToken(gatewayId);
  process.stdout.write(
    `cleared device token for gatewayId=${gatewayId} (was role=${before.role}, ${before.scopes.length} scopes)\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.message ?? e}\n`);
  process.exit(2);
});
