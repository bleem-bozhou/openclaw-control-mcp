// Final Discord probe: live channels.status + count stale-socket restarts.

import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";

function debug(msg: string) {
  if (process.env.OPENCLAW_DEBUG === "1") process.stderr.write(`${msg}\n`);
}

function fmt(ms: number | null | undefined): string {
  if (!ms) return "n/a";
  return new Date(ms).toISOString();
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

  // 1) live channels.status, focus on Discord
  const ch = (await client.request("channels.status", {})) as {
    channels: Record<string, Record<string, unknown>>;
    channelAccounts: Record<string, Array<Record<string, unknown>>>;
  };
  const d = ch.channels.discord ?? {};
  const a = ch.channelAccounts.discord?.[0] ?? {};
  process.stdout.write("=== Discord live status ===\n");
  process.stdout.write(JSON.stringify({
    discord_channel: {
      configured: d.configured,
      running: d.running,
      lastError: d.lastError,
      lastStartAt: fmt(d.lastStartAt as number),
      lastStopAt: fmt(d.lastStopAt as number),
    },
    discord_account_default: {
      enabled: a.enabled,
      running: a.running,
      connected: a.connected,
      reconnectAttempts: a.reconnectAttempts,
      restartPending: a.restartPending,
      lastError: a.lastError,
      lastDisconnect: a.lastDisconnect,
      lastStartAt: fmt(a.lastStartAt as number),
      lastStopAt: fmt(a.lastStopAt as number),
      lastConnectedAt: fmt(a.lastConnectedAt as number),
      lastEventAt: fmt(a.lastEventAt as number),
      lastInboundAt: fmt(a.lastInboundAt as number),
      lastOutboundAt: fmt(a.lastOutboundAt as number),
      tokenStatus: a.tokenStatus,
      bot: a.bot,
      intents: (a.application as Record<string, unknown>)?.intents,
    },
  }, null, 2) + "\n\n");

  // 2) Tail logs (max 2000) and count discord restart events / errors
  const tail = (await client.request("logs.tail", { limit: 2000 })) as { lines?: string[] };
  const lines = tail.lines ?? [];
  const discord: Array<{ ts: string; lvl: string; msg: string }> = [];
  for (const raw of lines) {
    try {
      const entry = JSON.parse(raw);
      const text = String(entry["1"] ?? "");
      if (!/discord|stale-socket|agent/i.test(text)) continue;
      discord.push({
        ts: entry._meta?.date ?? "",
        lvl: entry._meta?.logLevelName ?? "?",
        msg: text.slice(0, 220),
      });
    } catch {
      /* ignore */
    }
  }
  // Counts
  const counts = {
    "stale-socket restarts": discord.filter((l) => /stale-socket/.test(l.msg)).length,
    "fatal gateway close": discord.filter((l) => /Fatal gateway close/.test(l.msg)).length,
    "channel exited": discord.filter((l) => /channel exited/.test(l.msg)).length,
    "ready (post-restart)": discord.filter((l) => /discord client initialized/.test(l.msg)).length,
    "logged in to discord": discord.filter((l) => /logged in to discord/.test(l.msg)).length,
    "errors": discord.filter((l) => l.lvl === "ERROR").length,
    "warns": discord.filter((l) => l.lvl === "WARN").length,
  };
  process.stdout.write("=== Discord log event counts (last 2000 log lines) ===\n");
  process.stdout.write(JSON.stringify(counts, null, 2) + "\n\n");

  process.stdout.write("=== Last 25 Discord-related log lines ===\n");
  for (const l of discord.slice(-25)) {
    process.stdout.write(`[${l.ts}] ${l.lvl} ${l.msg}\n`);
  }

  await client.close();
}

await main();
