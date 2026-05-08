import { describe, expect, it } from "vitest";
import { buildIntrospectTools } from "../src/tools/introspect.js";
import { buildCronTools } from "../src/tools/cron.js";
import { buildConfigTools } from "../src/tools/config.js";
import type { CallOpts, ToolClient } from "../src/tools/client.js";
import { Store } from "../src/gateway/store.js";

function makeStub() {
  const calls: Array<{ method: string; params: unknown; opts?: CallOpts }> = [];
  let nextResponse: unknown = { ok: true };
  const stub: ToolClient = {
    async request(method, params, opts) {
      calls.push({ method, params, opts });
      return nextResponse as never;
    },
    async connect() {},
    async close() {},
    getDevice: () => null,
    getLastHello: () => null,
    getPairingPending: () => null,
    getGatewayId: () => "stub",
    getLastSuccessAtMs: () => null,
  };
  return {
    stub,
    calls,
    setNextResponse: (r: unknown) => {
      nextResponse = r;
    },
  };
}

describe("openclaw_call (introspect.ts) — params encoding fix", () => {
  it("rejects string params at the Zod layer (used to silently forward)", () => {
    const { stub } = makeStub();
    const tools = buildIntrospectTools(stub, new Store());
    const call = tools.find((t) => t.name === "openclaw_call");
    if (!call) throw new Error("openclaw_call missing");
    const parsed = call.inputSchema.safeParse({ method: "cron.list", params: "{}" });
    expect(parsed.success).toBe(false);
  });

  it("rejects array params", () => {
    const { stub } = makeStub();
    const call = buildIntrospectTools(stub, new Store()).find((t) => t.name === "openclaw_call");
    if (!call) throw new Error("openclaw_call missing");
    expect(call.inputSchema.safeParse({ method: "x", params: [] }).success).toBe(false);
  });

  it("forwards object params as object", async () => {
    const { stub, calls } = makeStub();
    const call = buildIntrospectTools(stub, new Store()).find((t) => t.name === "openclaw_call");
    if (!call) throw new Error("openclaw_call missing");
    const parsed = call.inputSchema.safeParse({ method: "cron.list", params: { limit: 10 } });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await call.handler(parsed.data);
    expect(calls[0]).toEqual({
      method: "cron.list",
      params: { limit: 10 },
      opts: {},
    });
  });

  it("defaults missing params to empty object (not undefined string)", async () => {
    const { stub, calls } = makeStub();
    const call = buildIntrospectTools(stub, new Store()).find((t) => t.name === "openclaw_call");
    if (!call) throw new Error("openclaw_call missing");
    const parsed = call.inputSchema.safeParse({ method: "cron.list" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await call.handler(parsed.data);
    expect(calls[0]?.params).toEqual({});
  });
});

describe("cron.update — wire format fix", () => {
  it("translates legacy {job:{id, ...}} into {id, patch}", async () => {
    const { stub, calls } = makeStub();
    const update = buildCronTools(stub).find((t) => t.name === "openclaw_cron_update");
    if (!update) throw new Error("update missing");
    const parsed = update.inputSchema.safeParse({
      job: { id: "abc", enabled: true, name: "x" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await update.handler(parsed.data);
    expect(calls[0]).toEqual({
      method: "cron.update",
      params: { id: "abc", patch: { enabled: true, name: "x" } },
      opts: {},
    });
  });

  it("forwards new shape {id, patch} verbatim", async () => {
    const { stub, calls } = makeStub();
    const update = buildCronTools(stub).find((t) => t.name === "openclaw_cron_update");
    if (!update) throw new Error("update missing");
    const parsed = update.inputSchema.safeParse({
      id: "abc",
      patch: { enabled: false },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await update.handler(parsed.data);
    expect(calls[0]?.params).toEqual({ id: "abc", patch: { enabled: false } });
  });

  it("accepts {jobId, patch} alias and maps to id", async () => {
    const { stub, calls } = makeStub();
    const update = buildCronTools(stub).find((t) => t.name === "openclaw_cron_update");
    if (!update) throw new Error("update missing");
    const parsed = update.inputSchema.safeParse({
      jobId: "abc",
      patch: { enabled: true },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await update.handler(parsed.data);
    expect(calls[0]?.params).toEqual({ id: "abc", patch: { enabled: true } });
  });

  it("rejects missing id at the wrapper", async () => {
    const { stub } = makeStub();
    const update = buildCronTools(stub).find((t) => t.name === "openclaw_cron_update");
    if (!update) throw new Error("update missing");
    const parsed = update.inputSchema.safeParse({ patch: { enabled: true } });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await expect(update.handler(parsed.data)).rejects.toThrow(/requires `id`/);
  });
});

describe("config.get — client-side path projection", () => {
  it("does NOT forward `path` to the gateway anymore", async () => {
    const { stub, calls, setNextResponse } = makeStub();
    setNextResponse({ parsed: { channels: { telegram: { dmPolicy: "open" } } } });
    const get = buildConfigTools(stub).find((t) => t.name === "openclaw_config_get");
    if (!get) throw new Error("get missing");
    const parsed = get.inputSchema.safeParse({ path: "channels.telegram" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const result = (await get.handler(parsed.data)) as {
      projectedPath?: string;
      projected?: unknown;
    };
    expect(calls[0]).toEqual({ method: "config.get", params: {}, opts: {} });
    expect(result.projectedPath).toBe("channels.telegram");
    expect(result.projected).toEqual({ dmPolicy: "open" });
  });
});

describe("sessions.list — client-side status filter", () => {
  it("does NOT forward `status` to the gateway", async () => {
    const { stub, calls, setNextResponse } = makeStub();
    setNextResponse({ sessions: [] });
    // Need fresh import to get sessions tools
    const { buildSessionsTools } = await import("../src/tools/sessions.js");
    const list = buildSessionsTools(stub).find((t) => t.name === "openclaw_sessions_list");
    if (!list) throw new Error("list missing");
    const parsed = list.inputSchema.safeParse({ status: "running", agentId: "main" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await list.handler(parsed.data);
    expect(calls[0]).toEqual({
      method: "sessions.list",
      params: { agentId: "main" },
      opts: {},
    });
  });

  it("filters returned sessions by status client-side", async () => {
    const { stub, setNextResponse } = makeStub();
    setNextResponse({
      sessions: [
        { key: "a", status: "running" },
        { key: "b", status: "done" },
        { key: "c", status: "running" },
      ],
    });
    const { buildSessionsTools } = await import("../src/tools/sessions.js");
    const list = buildSessionsTools(stub).find((t) => t.name === "openclaw_sessions_list");
    if (!list) throw new Error("list missing");
    const parsed = list.inputSchema.safeParse({ status: "running" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const result = (await list.handler(parsed.data)) as {
      sessions: Array<{ key: string; status: string }>;
      statusFilter?: string;
    };
    expect(result.sessions.map((s) => s.key)).toEqual(["a", "c"]);
    expect(result.statusFilter).toBe("running");
  });

  it("returns response untouched when no status filter is set", async () => {
    const { stub, setNextResponse } = makeStub();
    setNextResponse({ sessions: [{ key: "x", status: "done" }] });
    const { buildSessionsTools } = await import("../src/tools/sessions.js");
    const list = buildSessionsTools(stub).find((t) => t.name === "openclaw_sessions_list");
    if (!list) throw new Error("list missing");
    const parsed = list.inputSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const result = (await list.handler(parsed.data)) as { sessions: unknown[]; statusFilter?: string };
    expect(result.sessions).toHaveLength(1);
    expect(result.statusFilter).toBeUndefined();
  });
});

describe("logs.tail — client-side filters", () => {
  function mkLine(date: string, level: string, msg: string) {
    return JSON.stringify({ _meta: { date, logLevelName: level }, "1": msg });
  }

  it("does NOT forward sinceMs/level/component to the gateway", async () => {
    const { stub, calls, setNextResponse } = makeStub();
    setNextResponse({ lines: [] });
    const { buildLogsTools } = await import("../src/tools/logs.js");
    const tail = buildLogsTools(stub).find((t) => t.name === "openclaw_logs_tail");
    if (!tail) throw new Error("tail missing");
    const parsed = tail.inputSchema.safeParse({
      limit: 100,
      sinceMs: 1_700_000_000_000,
      level: "ERROR",
      component: "discord",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await tail.handler(parsed.data);
    expect(calls[0]).toEqual({
      method: "logs.tail",
      params: { limit: 100 },
      opts: {},
    });
  });

  it("filters by sinceMs", async () => {
    const { stub, setNextResponse } = makeStub();
    setNextResponse({
      lines: [
        mkLine("2026-05-07T15:00:00Z", "INFO", "old"),
        mkLine("2026-05-07T15:30:00Z", "INFO", "kept"),
        mkLine("2026-05-07T15:35:00Z", "INFO", "kept too"),
      ],
    });
    const { buildLogsTools } = await import("../src/tools/logs.js");
    const tail = buildLogsTools(stub).find((t) => t.name === "openclaw_logs_tail");
    if (!tail) throw new Error("tail missing");
    const cutoff = Date.parse("2026-05-07T15:30:00Z");
    const r = (await tail.handler({ sinceMs: cutoff })) as {
      lines: string[];
      clientFilter: { kept: number; dropped: number };
    };
    expect(r.lines).toHaveLength(2);
    expect(r.clientFilter.kept).toBe(2);
    expect(r.clientFilter.dropped).toBe(1);
  });

  it("filters by level case-insensitively", async () => {
    const { stub, setNextResponse } = makeStub();
    setNextResponse({
      lines: [
        mkLine("2026-05-07T15:00:00Z", "INFO", "x"),
        mkLine("2026-05-07T15:01:00Z", "ERROR", "boom"),
        mkLine("2026-05-07T15:02:00Z", "WARN", "y"),
      ],
    });
    const { buildLogsTools } = await import("../src/tools/logs.js");
    const tail = buildLogsTools(stub).find((t) => t.name === "openclaw_logs_tail");
    if (!tail) throw new Error("tail missing");
    const r = (await tail.handler({ level: "error" })) as { lines: string[] };
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("boom");
  });

  it("filters by component substring on the message text", async () => {
    const { stub, setNextResponse } = makeStub();
    setNextResponse({
      lines: [
        mkLine("2026-05-07T15:00:00Z", "INFO", "telegram polling started"),
        mkLine("2026-05-07T15:01:00Z", "INFO", "discord channel ready"),
        mkLine("2026-05-07T15:02:00Z", "INFO", "cron tick"),
      ],
    });
    const { buildLogsTools } = await import("../src/tools/logs.js");
    const tail = buildLogsTools(stub).find((t) => t.name === "openclaw_logs_tail");
    if (!tail) throw new Error("tail missing");
    const r = (await tail.handler({ component: "discord" })) as { lines: string[] };
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("discord");
  });

  it("returns lines untouched when no filters are set", async () => {
    const { stub, setNextResponse } = makeStub();
    setNextResponse({ lines: ["raw1", "raw2"] });
    const { buildLogsTools } = await import("../src/tools/logs.js");
    const tail = buildLogsTools(stub).find((t) => t.name === "openclaw_logs_tail");
    if (!tail) throw new Error("tail missing");
    const r = (await tail.handler({})) as { lines: string[]; clientFilter?: unknown };
    expect(r.lines).toEqual(["raw1", "raw2"]);
    expect(r.clientFilter).toBeUndefined();
  });
});

describe("config.patch — new wire format + merge convenience", () => {
  it("forwards {raw, baseHash} verbatim", async () => {
    const { stub, calls } = makeStub();
    const patch = buildConfigTools(stub).find((t) => t.name === "openclaw_config_patch");
    if (!patch) throw new Error("patch missing");
    const parsed = patch.inputSchema.safeParse({ raw: "{\"x\":1}", baseHash: "abc" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await patch.handler(parsed.data);
    expect(calls[0]).toEqual({
      method: "config.patch",
      params: { raw: "{\"x\":1}", baseHash: "abc" },
      opts: {},
    });
  });

  it("rejects legacy {path, value}", async () => {
    const { stub } = makeStub();
    const patch = buildConfigTools(stub).find((t) => t.name === "openclaw_config_patch");
    if (!patch) throw new Error("patch missing");
    const parsed = patch.inputSchema.safeParse({ path: "x", value: { y: 1 } });
    // Wrapper is permissive (zod doesn't strip, but no `raw`/`mergePath` provided → handler throws).
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await expect(patch.handler(parsed.data)).rejects.toThrow(/raw, baseHash|mergePath, mergeValue/);
  });

  it("convenience flow: mergePath + mergeValue fetches + deep-merges + sends raw", async () => {
    const { stub, calls, setNextResponse } = makeStub();
    let callIdx = 0;
    const stubMulti: ToolClient = {
      ...stub,
      async request(method, params, opts) {
        callIdx++;
        calls.push({ method, params, opts });
        if (method === "config.get") {
          return {
            parsed: { channels: { telegram: { dmPolicy: "closed", existing: true } } },
            baseHash: "h-1",
          } as never;
        }
        return { ok: true } as never;
      },
    };
    setNextResponse({}); // unused, stubMulti overrides
    const patch = buildConfigTools(stubMulti).find((t) => t.name === "openclaw_config_patch");
    if (!patch) throw new Error("patch missing");
    const parsed = patch.inputSchema.safeParse({
      mergePath: "channels.telegram",
      mergeValue: { dmPolicy: "open" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await patch.handler(parsed.data);
    expect(callIdx).toBe(2);
    expect(calls[0]?.method).toBe("config.get");
    expect(calls[1]?.method).toBe("config.patch");
    const sent = calls[1]?.params as { raw: string; baseHash: string };
    expect(sent.baseHash).toBe("h-1");
    const merged = JSON.parse(sent.raw) as Record<string, unknown>;
    expect(merged).toEqual({
      channels: { telegram: { dmPolicy: "open", existing: true } },
    });
  });
});
