// Deeper Discord probe: tail logs filtered client-side, peek a recent Discord session.

import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";

function debug(msg: string) {
  if (process.env.OPENCLAW_DEBUG === "1") process.stderr.write(`${msg}\n`);
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

  // 1) Tail more lines and filter client-side for "discord"
  const tail = (await client.request("logs.tail", { limit: 500 })) as {
    lines?: string[];
  };
  const lines = tail.lines ?? [];
  const discordLines: Array<{ ts: string; level: string; msg: string }> = [];
  for (const raw of lines) {
    try {
      const entry = JSON.parse(raw);
      const text = String(entry["1"] ?? "");
      if (!/discord/i.test(text)) continue;
      const meta = entry._meta ?? {};
      discordLines.push({
        ts: meta.date ?? entry.time ?? "",
        level: meta.logLevelName ?? "?",
        msg: text.slice(0, 280),
      });
    } catch {
      /* ignore */
    }
  }
  process.stdout.write(`\n=== discord-related log lines (${discordLines.length} of ${lines.length} tailed) ===\n`);
  for (const l of discordLines.slice(-40)) {
    process.stdout.write(`[${l.ts}] ${l.level} ${l.msg}\n`);
  }

  // 2) Preview the freshly-running discord channel session
  process.stdout.write("\n=== discord session preview (channel:<channel-id-redacted>, latest) ===\n");
  try {
    const preview = await client.request("sessions.preview", {
      keys: ["agent:main:discord:channel:<channel-id-redacted>"],
    });
    process.stdout.write(JSON.stringify(preview, null, 2).slice(0, 6000) + "\n");
  } catch (err) {
    process.stdout.write(`FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // 3) Check tools.effective for the agent — maybe a tool is disabled that prevents reply
  process.stdout.write("\n=== tools.effective for main ===\n");
  try {
    const eff = await client.request("tools.effective", { agentId: "main" });
    process.stdout.write(JSON.stringify(eff, null, 2).slice(0, 2000) + "\n");
  } catch (err) {
    process.stdout.write(`FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // 4) Look for any task/run failures recently
  process.stdout.write("\n=== task-related lines (last 200) ===\n");
  let count = 0;
  for (const raw of lines.slice(-200)) {
    try {
      const entry = JSON.parse(raw);
      const text = String(entry["1"] ?? "");
      if (!/task|cron|deliver|outbound|reply|send/i.test(text)) continue;
      if (entry._meta?.logLevelName === "INFO") continue; // skip noise
      const meta = entry._meta ?? {};
      process.stdout.write(`[${meta.date ?? entry.time}] ${meta.logLevelName} ${text.slice(0, 280)}\n`);
      count++;
      if (count > 30) break;
    } catch {
      /* ignore */
    }
  }

  await client.close();
}

await main();
