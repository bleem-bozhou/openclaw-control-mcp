import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildAdminTools(client: ToolClient): ToolDef[] {
  const updateRun: ToolDef = {
    name: "openclaw_update_run",
    description:
      "Trigger an update of the gateway itself (pull latest version, restart components). Wraps `update.run`. DESTRUCTIVE — may briefly interrupt running sessions. Confirm before calling.",
    inputSchema: withInstance(z
      .object({
        version: z.string().optional().describe("Specific version to install; omit for latest"),
      })
      .passthrough()),
    handler: passthroughHandler(client, "update.run"),
  };

  const commandsList: ToolDef = {
    name: "openclaw_commands_list",
    description:
      "List the slash-commands registered in the gateway (commands the agent or operator can invoke). Wraps `commands.list`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "commands.list"),
  };

  const messageAction: ToolDef = {
    name: "openclaw_message_action",
    description:
      "Trigger a message-level action (e.g. retry, mark-as-handled, attach to a session). Wraps `message.action`. Mutates gateway state.",
    inputSchema: withInstance(z
      .object({
        action: z.string().min(1).describe("Action name"),
        messageId: z.string().optional(),
        sessionId: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "message.action"),
  };

  return [updateRun, commandsList, messageAction];
}
