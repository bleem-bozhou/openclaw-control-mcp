// Verify the schema fixes against a live gateway, going through the typed
// wrappers (not raw client.request). Run with:
//   npx tsx scripts/verify-fixes.ts

import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";
import { buildCronTools } from "../src/tools/cron.js";
import { buildConfigTools } from "../src/tools/config.js";
import { buildIntrospectTools } from "../src/tools/introspect.js";
import type { CallOpts, ToolClient } from "../src/tools/client.js";

function debug(msg: string) {
  if (process.env.OPENCLAW_DEBUG === "1") process.stderr.write(`${msg}\n`);
}

async function probe(label: string, fn: () => Promise<unknown>): Promise<void> {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const result = await fn();
    process.stdout.write(`OK: ${JSON.stringify(result, null, 2).slice(0, 400)}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`FAIL: ${msg}\n`);
  }
}

async function main() {
  const store = new Store();
  const cfg = await store.loadConfig();
  if (!cfg.gatewayUrl) {
    process.stderr.write("no gateway configured — run openclaw_setup first\n");
    process.exit(1);
  }
  const real = new GatewayClient({
    url: cfg.gatewayUrl,
    token: cfg.gatewayToken,
    password: cfg.gatewayPassword,
    store,
    debug,
  });
  await real.connect();

  // Wrap in a minimal ToolClient shim that ignores the instance opt (single instance test).
  const client: ToolClient = {
    request: (method, params, _opts?: CallOpts) => real.request(method, params),
    connect: () => real.connect(),
    close: () => real.close(),
    getDevice: () => real.getDevice(),
    getLastHello: () => real.getLastHello() as never,
    getPairingPending: () => real.getPairingPending(),
    getGatewayId: () => real.getGatewayId(),
    getLastSuccessAtMs: () => real.getLastSuccessAtMs(),
  };

  const cronTools = new Map(buildCronTools(client).map((t) => [t.name, t]));
  const configTools = new Map(buildConfigTools(client).map((t) => [t.name, t]));
  const introspectTools = new Map(buildIntrospectTools(client, store).map((t) => [t.name, t]));

  async function callTool(map: Map<string, { handler: (a: unknown) => Promise<unknown>; inputSchema: { safeParse: (a: unknown) => { success: boolean; error?: { message: string }; data?: unknown } } }>, name: string, args: unknown) {
    const tool = map.get(name);
    if (!tool) throw new Error(`tool ${name} not found`);
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) throw new Error(`Zod rejected: ${parsed.error?.message}`);
    return tool.handler(parsed.data);
  }

  // Fix 1: openclaw_call must reject string params
  await probe("openclaw_call rejects string params at Zod", () =>
    callTool(introspectTools, "openclaw_call", { method: "cron.list", params: "{}" }),
  );
  await probe("openclaw_call accepts {} object params and gateway returns jobs", async () => {
    const r = (await callTool(introspectTools, "openclaw_call", { method: "cron.list", params: {} })) as { jobs?: unknown[] };
    return { jobsCount: Array.isArray(r.jobs) ? r.jobs.length : "?" };
  });
  await probe("openclaw_call accepts no params (omitted)", async () => {
    const r = (await callTool(introspectTools, "openclaw_call", { method: "cron.list" })) as { jobs?: unknown[] };
    return { jobsCount: Array.isArray(r.jobs) ? r.jobs.length : "?" };
  });

  // Fix 2: cron.update — both new and legacy shapes
  await probe("cron.update legacy {job:{id,...}} translated", () =>
    callTool(cronTools, "openclaw_cron_update", { job: { id: "this-is-fake", enabled: true } }),
  );
  await probe("cron.update new {id, patch}", () =>
    callTool(cronTools, "openclaw_cron_update", { id: "this-is-fake", patch: { enabled: true } }),
  );
  await probe("cron.update new {jobId, patch}", () =>
    callTool(cronTools, "openclaw_cron_update", { jobId: "this-is-fake", patch: { enabled: true } }),
  );
  await probe("cron.update missing id (should fail at wrapper)", () =>
    callTool(cronTools, "openclaw_cron_update", { patch: { enabled: true } }),
  );

  // Fix 3: config.get with path now does client-side projection
  await probe("config.get with path='channels' projects client-side", async () => {
    const r = (await callTool(configTools, "openclaw_config_get", { path: "channels" })) as {
      projectedPath?: string;
      projected?: unknown;
    };
    return {
      projectedPath: r.projectedPath,
      projectedKeys: r.projected && typeof r.projected === "object" ? Object.keys(r.projected) : null,
    };
  });
  await probe("config.get no path returns full config", async () => {
    const r = (await callTool(configTools, "openclaw_config_get", {})) as {
      parsed?: Record<string, unknown>;
    };
    return { topKeys: r.parsed ? Object.keys(r.parsed).slice(0, 6) : null };
  });

  // Fix 4: config.patch — only check that the new shape passes the wrapper.
  // Don't actually mutate prod config; we expect the gateway to reject with a
  // baseHash mismatch (proving the wrapper accepted our shape).
  await probe("config.patch new shape {raw, baseHash} passes wrapper, gateway rejects on hash", () =>
    callTool(configTools, "openclaw_config_patch", {
      raw: JSON.stringify({ probe: "no-op" }),
      baseHash: "fake-hash-for-schema-probe",
    }),
  );
  await probe("config.patch old shape {path, value} rejected by wrapper", () =>
    callTool(configTools, "openclaw_config_patch", {
      path: "channels.telegram",
      value: { dmPolicy: "open" },
    }),
  );

  await real.close();
}

await main();
