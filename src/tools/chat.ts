import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildChatTools(client: ToolClient): ToolDef[] {
  const send: ToolDef = {
    name: "openclaw_chat_send",
    description:
      "Send a chat message via the gateway's native chat method. Wraps `chat.send`. This is the management-plane equivalent of the upstream `openclaw-mcp` chat (which 404s on this gateway). Pass agentId/sessionId/text; consult openclaw_chat_history for the param shape used by your gateway.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().optional(),
        sessionId: z.string().optional(),
        text: z.string().optional(),
        message: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "chat.send"),
  };

  const history: ToolDef = {
    name: "openclaw_chat_history",
    description:
      "Fetch chat history for an agent or session. Wraps `chat.history`. Read-only.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().optional(),
        sessionId: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "chat.history"),
  };

  const abort: ToolDef = {
    name: "openclaw_chat_abort",
    description:
      "Abort an in-flight chat turn. Wraps `chat.abort`. Destructive — cancels running LLM call.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().optional(),
        sessionId: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "chat.abort"),
  };

  return [send, history, abort];
}
