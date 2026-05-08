// Verify the new schema fixes (sessions.list status, logs.tail sinceMs/level/component)
// against a live gateway, going through the typed wrappers.

import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";
import { buildSessionsTools } from "../src/tools/sessions.js";
import { buildLogsTools } from "../src/tools/logs.js";
import type { CallOpts, ToolClient } from "../src/tools/client.js";

function debug(msg: string) {
  if (process.env.OPENCLAW_DEBUG === "1") process.stderr.write(`${msg}\n`);
}

async function probe(label: string, fn: () => Promise<unknown>): Promise<void> {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const result = await fn();
    process.stdout.write(`OK: ${JSON.stringify(result, null, 2).slice(0, 600)}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`FAIL: ${msg}\n`);
  }
}

async function main() {
  const store = new Store();
  const cfg = await store.loadConfig();
  if (!cfg.gatewayUrl) process.exit(1);
  const real = new GatewayClient({
    url: cfg.gatewayUrl,
    token: cfg.gatewayToken,
    password: cfg.gatewayPassword,
    store,
    debug,
  });
  await real.connect();

  const client: ToolClient = {
    request: (m, p, _o?: CallOpts) => real.request(m, p),
    connect: () => real.connect(),
    close: () => real.close(),
    getDevice: () => real.getDevice(),
    getLastHello: () => real.getLastHello() as never,
    getPairingPending: () => real.getPairingPending(),
    getGatewayId: () => real.getGatewayId(),
    getLastSuccessAtMs: () => real.getLastSuccessAtMs(),
  };

  const sessions = new Map(buildSessionsTools(client).map((t) => [t.name, t]));
  const logs = new Map(buildLogsTools(client).map((t) => [t.name, t]));

  async function callTool(map: Map<string, { handler: (a: unknown) => Promise<unknown>; inputSchema: { safeParse: (a: unknown) => { success: boolean; error?: { message: string }; data?: unknown } } }>, name: string, args: unknown) {
    const tool = map.get(name);
    if (!tool) throw new Error(`tool ${name} not found`);
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) throw new Error(`Zod rejected: ${parsed.error?.message}`);
    return tool.handler(parsed.data);
  }

  // sessions.list — status filter
  await probe("sessions.list (no filter) — gateway returns full list", async () => {
    const r = (await callTool(sessions, "openclaw_sessions_list", {})) as { sessions?: unknown[] };
    return { count: Array.isArray(r.sessions) ? r.sessions.length : "?" };
  });

  await probe("sessions.list status=running — client-side filter", async () => {
    const r = (await callTool(sessions, "openclaw_sessions_list", { status: "running" })) as {
      sessions?: Array<{ key?: string; status?: string }>;
      statusFilter?: string;
    };
    return {
      count: r.sessions?.length ?? 0,
      statusFilter: r.statusFilter,
      sample: r.sessions?.slice(0, 3).map((s) => ({ key: s.key, status: s.status })),
    };
  });

  // logs.tail — sinceMs / level / component
  await probe("logs.tail limit=200 sinceMs=15:30 component=discord level=INFO", async () => {
    const cutoff = Date.parse("2026-05-07T15:30:00Z");
    const r = (await callTool(logs, "openclaw_logs_tail", {
      limit: 200,
      sinceMs: cutoff,
      component: "discord",
      level: "INFO",
    })) as { lines?: string[]; clientFilter?: unknown };
    return {
      kept: Array.isArray(r.lines) ? r.lines.length : "?",
      clientFilter: r.clientFilter,
    };
  });

  await probe("logs.tail no filters (gateway returns lines)", async () => {
    const r = (await callTool(logs, "openclaw_logs_tail", { limit: 5 })) as { lines?: string[] };
    return { count: Array.isArray(r.lines) ? r.lines.length : "?" };
  });

  await real.close();
}

await main();
