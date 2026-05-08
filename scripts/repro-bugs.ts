// Standalone repro script for the [Unreleased] known issues. Bypasses MCP and
// hits the gateway directly through GatewayClient. Run with:
//   npx tsx scripts/repro-bugs.ts
//
// Discardable — kept under scripts/ (not in npm files whitelist) for future
// regressions.

import { GatewayClient } from "../src/gateway/client.js";
import { Store } from "../src/gateway/store.js";

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
  if (!cfg.gatewayUrl) {
    process.stderr.write("no gateway configured — run openclaw_setup first\n");
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
  process.stdout.write(`connected to ${cfg.gatewayUrl}\n`);

  // BUG 1: cron.list with empty params via raw "openclaw_call equivalent"
  await probe("cron.list raw {}", () => client.request("cron.list", {}));
  await probe("cron.list raw undefined", () => client.request("cron.list"));

  // BUG 2: cron.update — gateway expects {jobId|id, patch}
  await probe("cron.update old shape {job:{id,...}}", () =>
    client.request("cron.update", {
      job: { id: "this-is-fake", enabled: true },
    }),
  );
  await probe("cron.update new shape {id, patch}", () =>
    client.request("cron.update", {
      id: "this-is-fake",
      patch: { enabled: true },
    }),
  );
  await probe("cron.update new shape {jobId, patch}", () =>
    client.request("cron.update", {
      jobId: "this-is-fake",
      patch: { enabled: true },
    }),
  );

  // BUG 3: config.get with path filter
  await probe("config.get with path", () => client.request("config.get", { path: "channels" }));
  await probe("config.get no params", () => client.request("config.get", {}));

  // BUG 4: config.patch — gateway expects {raw, baseHash}
  await probe("config.patch old shape {path,value}", () =>
    client.request("config.patch", { path: "x", value: { y: 1 } }),
  );
  // Don't actually apply — just see whether the schema accepts the new shape.
  // Use a fake baseHash; the gateway should reject with a hash mismatch, NOT a schema error.
  await probe("config.patch new shape {raw, baseHash} (fake hash)", () =>
    client.request("config.patch", { raw: { x: { y: 1 } }, baseHash: "fake-hash-for-schema-probe" }),
  );

  // BUG 5: openclaw_call's z.unknown() Zod accepts strings — does the
  // gateway's "must be object" come from a stringified params?
  await probe("cron.list with params=\"{}\" (string)", () =>
    client.request("cron.list", "{}" as unknown as object),
  );

  await client.close();
}

await main();
