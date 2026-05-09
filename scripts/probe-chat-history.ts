// Probe chat.history wire format.
import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";

async function main() {
  const store = new Store();
  const cfg = await store.loadConfig();
  if (!cfg.gatewayUrl) process.exit(1);
  const c = new GatewayClient({
    url: cfg.gatewayUrl,
    token: cfg.gatewayToken,
    password: cfg.gatewayPassword,
    store,
  });
  await c.connect();

  for (const args of [
    { sessionKey: "agent:main:main" },
    { sessionKey: "agent:main:main", limit: 5 },
    { sessionKey: "agent:main:main", limit: 5, offset: 0 },
    { sessionKey: "agent:main:main", agentId: "main" },
    { sessionId: "agent:main:main" },
  ] as Array<Record<string, unknown>>) {
    try {
      const r = await c.request("chat.history", args);
      const sample = JSON.stringify(r).slice(0, 200);
      process.stdout.write(`chat.history ${JSON.stringify(args)} → OK ${sample}\n`);
    } catch (err) {
      process.stdout.write(`chat.history ${JSON.stringify(args)} → ${(err as Error).message.slice(0, 200)}\n`);
    }
  }
  await c.close();
}

await main();
