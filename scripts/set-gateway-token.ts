// Update the persisted gateway admin token for an instance. Useful after a
// gateway-side token rotation that left the local store with a stale value
// (manifest: `AUTH_TOKEN_MISMATCH` on every connect). Merges with the existing
// instance config so gatewayUrl / gatewayPassword / savedAtMs are preserved.
//
// Usage:
//   npx tsx scripts/set-gateway-token.ts --token "<new-admin-token>"
//   npx tsx scripts/set-gateway-token.ts --token "<new-admin-token>" --instance default
//   OPENCLAW_GATEWAY_TOKEN=<new> npx tsx scripts/set-gateway-token.ts

import { Store } from "../src/gateway/store.js";

async function main() {
  const args = process.argv.slice(2);
  const tokenIdx = args.indexOf("--token");
  const token = tokenIdx >= 0 ? args[tokenIdx + 1] : process.env.OPENCLAW_GATEWAY_TOKEN;
  const instIdx = args.indexOf("--instance");
  const instance = instIdx >= 0 ? (args[instIdx + 1] ?? "default") : "default";

  if (!token || !token.trim()) {
    process.stderr.write(
      "usage: tsx scripts/set-gateway-token.ts --token <T> [--instance default]\n" +
        "       (or set OPENCLAW_GATEWAY_TOKEN in the environment)\n",
    );
    process.exit(1);
  }

  const store = new Store();
  await store.saveConfig({ gatewayToken: token.trim() }, instance);
  process.stdout.write(
    `updated gatewayToken for instance '${instance}' (${token.trim().length} chars)\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.message ?? e}\n`);
  process.exit(2);
});
