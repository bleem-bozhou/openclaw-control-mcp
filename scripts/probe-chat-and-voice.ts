// Probe chat.* and voice/tts/talk/voicewake methods to surface schema drifts.
import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";

async function probe(c: GatewayClient, method: string, args: Record<string, unknown>) {
  try {
    const r = await c.request(method, args);
    process.stdout.write(`${method} ${JSON.stringify(args)} → OK ${JSON.stringify(r).slice(0, 160)}\n`);
  } catch (err) {
    process.stdout.write(`${method} ${JSON.stringify(args)} → ${(err as Error).message.slice(0, 250)}\n`);
  }
}

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

  process.stdout.write("--- chat.send (probe shape only with empty/invalid args, not actually sending) ---\n");
  await probe(c, "chat.send", {});
  await probe(c, "chat.send", { sessionKey: "agent:main:main" });
  await probe(c, "chat.send", { sessionKey: "agent:main:main", text: "" });

  process.stdout.write("\n--- chat.abort ---\n");
  await probe(c, "chat.abort", {});
  await probe(c, "chat.abort", { sessionKey: "agent:main:main" });
  await probe(c, "chat.abort", { agentId: "main" });

  process.stdout.write("\n--- talk.config ---\n");
  await probe(c, "talk.config", {});

  process.stdout.write("\n--- talk.mode ---\n");
  await probe(c, "talk.mode", {});

  process.stdout.write("\n--- voicewake.get ---\n");
  await probe(c, "voicewake.get", {});

  process.stdout.write("\n--- tts.status ---\n");
  await probe(c, "tts.status", {});

  process.stdout.write("\n--- tts.providers ---\n");
  await probe(c, "tts.providers", {});

  await c.close();
}

await main();
