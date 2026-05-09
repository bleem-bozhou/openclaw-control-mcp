import { randomUUID } from "node:crypto";
import { z } from "zod";
import { passthroughHandler, splitInstance, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

/**
 * The chat.* family is keyed by `sessionKey` (the composite key
 * `agent:<agentId>:<scope>` returned by sessions.list), NOT by the
 * agent/sessionId pair the pre-0.5.x wrappers exposed. Verified live
 * against gateway 2026.4.12+ — the `agentId`/`sessionId`/`text` shapes
 * the older wrappers accepted are rejected as `unexpected property`.
 */
export function buildChatTools(client: ToolClient): ToolDef[] {
  const send: ToolDef = {
    name: "openclaw_chat_send",
    description:
      "Send a message into a chat session via the gateway's chat layer. Wire format (verified live against gateway 2026.4.12+): requires `sessionKey` (composite, e.g. 'agent:main:main' from openclaw_sessions_list), `message`, and `idempotencyKey` (auto-generated UUID if omitted). The pre-0.5.x `agentId`/`sessionId`/`text` shape is rejected by the gateway. Destructive — triggers an agent turn.",
    inputSchema: withInstance(z
      .object({
        sessionKey: z.string().min(1).describe("Composite session key from openclaw_sessions_list (e.g. 'agent:main:main', 'agent:main:cron:<id>')."),
        message: z.string().min(1).describe("Message body."),
        idempotencyKey: z.string().optional().describe("Unique key to dedupe retries. Auto-generated UUID if omitted."),
      })
      .passthrough()),
    handler: async (args) => {
      const { rest, opts } = splitInstance(args);
      const a = rest as { sessionKey: string; message: string; idempotencyKey?: string; [k: string]: unknown };
      const params = { ...a, idempotencyKey: a.idempotencyKey ?? randomUUID() };
      return client.request("chat.send", params, opts);
    },
  };

  const history: ToolDef = {
    name: "openclaw_chat_history",
    description:
      "Fetch chat history for a session. Wraps `chat.history`. Wire format (verified live): requires `sessionKey`; accepts `limit`. Read-only. The pre-0.5.x `agentId`/`sessionId`/`offset` fields are rejected.",
    inputSchema: withInstance(z
      .object({
        sessionKey: z.string().min(1).describe("Composite session key from openclaw_sessions_list."),
        limit: z.number().int().positive().max(500).optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "chat.history"),
  };

  const abort: ToolDef = {
    name: "openclaw_chat_abort",
    description:
      "Abort an in-flight chat turn for a session. Wraps `chat.abort`. Wire format (verified live): requires `sessionKey`. Destructive — cancels running LLM call.",
    inputSchema: withInstance(z
      .object({
        sessionKey: z.string().min(1).describe("Composite session key from openclaw_sessions_list."),
      })
      .passthrough()),
    handler: passthroughHandler(client, "chat.abort"),
  };

  return [send, history, abort];
}
