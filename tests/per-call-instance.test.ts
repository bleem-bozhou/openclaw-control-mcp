import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  passthroughHandler,
  splitInstance,
  withInstance,
  type ToolClient,
} from "../src/tools/client.js";

function makeStubClient() {
  const calls: Array<{ method: string; params: unknown; opts?: { instance?: string } }> = [];
  const stub: ToolClient = {
    async request(method, params, opts) {
      calls.push({ method, params, opts });
      return { ok: true } as never;
    },
    async connect() {
      return null;
    },
    async close() {},
    getDevice: () => null,
    getLastHello: () => null,
    getPairingPending: () => null,
    getGatewayId: () => "stub",
    getLastSuccessAtMs: () => null,
  };
  return { stub, calls };
}

describe("withInstance", () => {
  it("adds an optional `instance` field to a base schema", () => {
    const base = z.object({ id: z.string() });
    const extended = withInstance(base);
    const ok = extended.safeParse({ id: "x" });
    const okWithInstance = extended.safeParse({ id: "x", instance: "work" });
    expect(ok.success).toBe(true);
    expect(okWithInstance.success).toBe(true);
  });

  it("rejects non-string instance values", () => {
    const extended = withInstance(z.object({}));
    const bad = extended.safeParse({ instance: 42 });
    expect(bad.success).toBe(false);
  });

  it("rejects empty-string instance values (min length 1)", () => {
    const extended = withInstance(z.object({}));
    const bad = extended.safeParse({ instance: "" });
    expect(bad.success).toBe(false);
  });
});

describe("splitInstance", () => {
  it("pulls `instance` out and leaves the rest untouched", () => {
    const { rest, opts } = splitInstance({ id: "x", instance: "work", extra: 1 });
    expect(rest).toEqual({ id: "x", extra: 1 });
    expect(opts).toEqual({ instance: "work" });
  });

  it("returns empty opts when no instance is provided", () => {
    const { rest, opts } = splitInstance({ id: "x" });
    expect(rest).toEqual({ id: "x" });
    expect(opts).toEqual({});
  });

  it("treats undefined args as empty object", () => {
    const { rest, opts } = splitInstance(undefined);
    expect(rest).toEqual({});
    expect(opts).toEqual({});
  });

  it("ignores non-string `instance` (defensive guard)", () => {
    const { opts } = splitInstance({ instance: 42 });
    expect(opts).toEqual({});
  });
});

describe("passthroughHandler", () => {
  it("forwards method + rest + opts to client.request", async () => {
    const { stub, calls } = makeStubClient();
    const handler = passthroughHandler(stub, "cron.list");
    await handler({ id: "abc", instance: "perso" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      method: "cron.list",
      params: { id: "abc" },
      opts: { instance: "perso" },
    });
  });

  it("works without an instance arg", async () => {
    const { stub, calls } = makeStubClient();
    const handler = passthroughHandler(stub, "status");
    await handler({ verbose: true });
    expect(calls[0]).toEqual({
      method: "status",
      params: { verbose: true },
      opts: {},
    });
  });
});
