import { describe, expect, it } from "vitest";
import { buildChatTools } from "../src/tools/chat.js";
import { buildTalkTools } from "../src/tools/talk.js";
import { makeMockClient } from "./helpers/mock-client.js";

function getTool(builder: () => Array<{ name: string; inputSchema: { safeParse: (a: unknown) => { success: boolean } }; handler: (a: unknown) => Promise<unknown> }>, name: string) {
  const handle = makeMockClient();
  const builderWithClient = (() => builder()) as never;
  // Need to call builder with client — adapt
  return { handle };
}

describe("chat.* — wire format alignment", () => {
  describe("openclaw_chat_send", () => {
    it("requires sessionKey + message at the wrapper level", async () => {
      const handle = makeMockClient();
      const send = buildChatTools(handle.client).find((t) => t.name === "openclaw_chat_send");
      if (!send) throw new Error("send missing");

      // Empty args → rejected
      expect(send.inputSchema.safeParse({}).success).toBe(false);
      // Only sessionKey → rejected
      expect(send.inputSchema.safeParse({ sessionKey: "agent:main:main" }).success).toBe(false);
      // sessionKey + message → ok
      const ok = send.inputSchema.safeParse({ sessionKey: "agent:main:main", message: "hi" });
      expect(ok.success).toBe(true);
    });

    it("auto-generates idempotencyKey when omitted", async () => {
      const handle = makeMockClient();
      const send = buildChatTools(handle.client).find((t) => t.name === "openclaw_chat_send");
      if (!send) throw new Error("send missing");
      const parsed = send.inputSchema.safeParse({ sessionKey: "agent:main:main", message: "hi" });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      await send.handler(parsed.data);
      const params = handle.calls[0]?.params as { idempotencyKey?: string };
      expect(typeof params.idempotencyKey).toBe("string");
      expect(params.idempotencyKey?.length).toBeGreaterThan(20); // UUID-like
    });

    it("preserves explicit idempotencyKey when provided", async () => {
      const handle = makeMockClient();
      const send = buildChatTools(handle.client).find((t) => t.name === "openclaw_chat_send");
      if (!send) throw new Error("send missing");
      const parsed = send.inputSchema.safeParse({
        sessionKey: "agent:main:main",
        message: "hi",
        idempotencyKey: "fixed-key-123",
      });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      await send.handler(parsed.data);
      const params = handle.calls[0]?.params as { idempotencyKey?: string };
      expect(params.idempotencyKey).toBe("fixed-key-123");
    });
  });

  describe("openclaw_chat_history", () => {
    it("requires sessionKey", () => {
      const handle = makeMockClient();
      const history = buildChatTools(handle.client).find((t) => t.name === "openclaw_chat_history");
      if (!history) throw new Error("history missing");
      expect(history.inputSchema.safeParse({}).success).toBe(false);
      expect(history.inputSchema.safeParse({ agentId: "main" }).success).toBe(false);
      expect(history.inputSchema.safeParse({ sessionKey: "agent:main:main" }).success).toBe(true);
      expect(
        history.inputSchema.safeParse({ sessionKey: "agent:main:main", limit: 5 }).success,
      ).toBe(true);
    });
  });

  describe("openclaw_chat_abort", () => {
    it("requires sessionKey", () => {
      const handle = makeMockClient();
      const abort = buildChatTools(handle.client).find((t) => t.name === "openclaw_chat_abort");
      if (!abort) throw new Error("abort missing");
      expect(abort.inputSchema.safeParse({}).success).toBe(false);
      expect(abort.inputSchema.safeParse({ sessionKey: "agent:main:main" }).success).toBe(true);
    });
  });
});

describe("talk.mode — wire format alignment", () => {
  it("requires `enabled: boolean`", () => {
    const handle = makeMockClient();
    const mode = buildTalkTools(handle.client).find((t) => t.name === "openclaw_talk_mode");
    if (!mode) throw new Error("talk_mode missing");
    expect(mode.inputSchema.safeParse({}).success).toBe(false);
    expect(mode.inputSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(mode.inputSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(mode.inputSchema.safeParse({ enabled: "yes" }).success).toBe(false);
  });
});

describe("openclaw_agent + openclaw_send — auto idempotencyKey", () => {
  it("openclaw_agent auto-generates idempotencyKey", async () => {
    const { buildStatusTools } = await import("../src/tools/status.js");
    const handle = makeMockClient();
    const agent = buildStatusTools(handle.client).find((t) => t.name === "openclaw_agent");
    if (!agent) throw new Error("agent missing");
    const parsed = agent.inputSchema.safeParse({ message: "test" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await agent.handler(parsed.data);
    const params = handle.calls[0]?.params as { message?: string; idempotencyKey?: string };
    expect(params.message).toBe("test");
    expect(typeof params.idempotencyKey).toBe("string");
  });

  it("openclaw_send auto-generates idempotencyKey", async () => {
    const { buildStatusTools } = await import("../src/tools/status.js");
    const handle = makeMockClient();
    const send = buildStatusTools(handle.client).find((t) => t.name === "openclaw_send");
    if (!send) throw new Error("send missing");
    const parsed = send.inputSchema.safeParse({ to: "-1001234" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await send.handler(parsed.data);
    const params = handle.calls[0]?.params as { to?: string; idempotencyKey?: string };
    expect(params.to).toBe("-1001234");
    expect(typeof params.idempotencyKey).toBe("string");
  });
});

describe("wizard.status — sessionId required", () => {
  it("rejects empty args", async () => {
    const { buildWizardTools } = await import("../src/tools/wizard.js");
    const handle = makeMockClient();
    const status = buildWizardTools(handle.client).find((t) => t.name === "openclaw_wizard_status");
    if (!status) throw new Error("wizard_status missing");
    expect(status.inputSchema.safeParse({}).success).toBe(false);
    expect(status.inputSchema.safeParse({ sessionId: "agent:main:main" }).success).toBe(true);
  });
});
