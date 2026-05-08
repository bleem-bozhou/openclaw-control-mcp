// Discord bot health probe via the live gateway. Run with:
//   npx tsx scripts/check-discord.ts

import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";

function debug(msg: string) {
  if (process.env.OPENCLAW_DEBUG === "1") process.stderr.write(`${msg}\n`);
}

async function probe(label: string, fn: () => Promise<unknown>): Promise<unknown> {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const result = await fn();
    process.stdout.write(JSON.stringify(result, null, 2).slice(0, 4000) + "\n");
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`FAIL: ${msg}\n`);
    return { error: msg };
  }
}

async function main() {
  const store = new Store();
  const cfg = await store.loadConfig();
  if (!cfg.gatewayUrl) {
    process.stderr.write("no gateway configured\n");
    process.exit(1);
  }
  const client = new GatewayClient({
    url: cfg.gatewayUrl,
    token: cfg.gatewayToken,
    password: cfg.gatewayPassword,
    store,
    debug,
  });
  await client.connect();

  await probe("channels.status", () => client.request("channels.status", {}));
  await probe("config.get → channels", () => client.request("config.get", {}));
  await probe("logs.tail (last 50, level=error/warn)", () =>
    client.request("logs.tail", { limit: 50 }),
  );
  await probe("logs.tail (component filter: discord)", () =>
    client.request("logs.tail", { limit: 50, component: "discord" }),
  );
  await probe("status (root)", () => client.request("status", {}));
  await probe("system-presence", () => client.request("system-presence", {}));

  await client.close();
}

await main();
