// Look for the unanswered inbound at 15:32 and dig into why no reply went out.

import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";

function debug(msg: string) {
  if (process.env.OPENCLAW_DEBUG === "1") process.stderr.write(`${msg}\n`);
}

async function main() {
  const store = new Store();
  const cfg = await store.loadConfig();
  if (!cfg.gatewayUrl) process.exit(1);
  const client = new GatewayClient({
    url: cfg.gatewayUrl,
    token: cfg.gatewayToken,
    password: cfg.gatewayPassword,
    store,
    debug,
  });
  await client.connect();

  // 1) preview both discord channel sessions to see what's the last message
  const keys = [
    "agent:main:discord:channel:<channel-id-redacted>", // #bot
    "agent:main:discord:channel:<channel-id-redacted>", // #reports
  ];
  const preview = (await client.request("sessions.preview", { keys })) as {
    previews?: Array<{
      key: string;
      status?: string;
      items?: Array<{ role: string; text: string }>;
    }>;
  };

  for (const p of preview.previews ?? []) {
    process.stdout.write(`\n=== ${p.key} (status=${p.status}) ===\n`);
    const items = p.items ?? [];
    process.stdout.write(`(showing last 6 of ${items.length} items)\n`);
    for (const it of items.slice(-6)) {
      const t = it.text.slice(0, 220).replace(/\n/g, " ⏎ ");
      process.stdout.write(`  [${it.role}] ${t}\n`);
    }
  }

  // 2) sessions.list — status filter rejected by gateway, filter client-side
  process.stdout.write("\n=== sessions.list (running, filtered client-side) ===\n");
  try {
    const list = (await client.request("sessions.list", {})) as {
      sessions?: Array<{ key: string; status: string; updatedAt?: number; updatedAtMs?: number }>;
    };
    const running = (list.sessions ?? []).filter((s) => s.status === "running");
    process.stdout.write(`running count = ${running.length}\n`);
    for (const s of running.slice(0, 10)) {
      process.stdout.write(`  ${s.key} updatedAt=${s.updatedAtMs ? new Date(s.updatedAtMs).toISOString() : "?"}\n`);
    }
  } catch (e) {
    process.stdout.write(`FAIL: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  // 3) tail recent logs (gateway rejects sinceMs — filter client-side)
  process.stdout.write("\n=== logs since 15:30 UTC, discord/agent/error only ===\n");
  const tail = (await client.request("logs.tail", { limit: 1000 })) as { lines?: string[] };
  const cutoffMs = Date.parse("2026-05-07T15:30:00Z");
  for (const raw of tail.lines ?? []) {
    try {
      const entry = JSON.parse(raw);
      const dateStr = entry._meta?.date ?? entry.time ?? "";
      const t = Date.parse(dateStr);
      if (Number.isNaN(t) || t < cutoffMs) continue;
      const text = String(entry["1"] ?? "");
      if (!/discord|agent|error|task|reply|outbound|cron|session|agent/i.test(text)) continue;
      if (entry._meta?.logLevelName === "INFO" && /heartbeat|tick|prune|presence/i.test(text)) continue;
      const lvl = entry._meta?.logLevelName ?? "?";
      process.stdout.write(`[${dateStr}] ${lvl} ${text.slice(0, 280)}\n`);
    } catch {
      /* ignore */
    }
  }

  await client.close();
}

await main();
