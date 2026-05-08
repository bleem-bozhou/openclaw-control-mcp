import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

const agentIdOnly = z.object({ agentId: z.string().min(1).describe("Agent id, e.g. 'main'") });

export function buildAgentsTools(client: ToolClient): ToolDef[] {
  const list: ToolDef = {
    name: "openclaw_agents_list",
    description:
      "List configured agents on the gateway (e.g. 'main', custom agents). Wraps `agents.list`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "agents.list"),
  };

  const create: ToolDef = {
    name: "openclaw_agents_create",
    description:
      "Create a new agent configuration. Wraps `agents.create`. Pass `agentId`, `displayName`, `model`, plus any extra fields the gateway accepts (system prompt, default tools, etc.). Call openclaw_agents_list first to see the full shape of an existing agent.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().min(1).optional().describe("Agent identifier (e.g. 'support-bot'). Defaults to a generated id if omitted."),
        id: z.string().optional().describe("Alias for agentId — pass either, not both."),
        displayName: z.string().optional().describe("Human-readable name shown in the Control panel."),
        model: z.string().optional().describe("Default model id (e.g. 'claude-sonnet-4-6')."),
      })
      .passthrough()),
    handler: passthroughHandler(client, "agents.create"),
  };

  const update: ToolDef = {
    name: "openclaw_agents_update",
    description:
      "Update an existing agent's configuration. Wraps `agents.update`. Pass `agentId` + only the fields you want to change. Schema is permissive — gateway accepts the same shape as `agents.create`.",
    inputSchema: withInstance(agentIdOnly.passthrough()),
    handler: passthroughHandler(client, "agents.update"),
  };

  const remove: ToolDef = {
    name: "openclaw_agents_delete",
    description:
      "Delete an agent configuration. Wraps `agents.delete`. Destructive — confirm before calling. Sessions tied to this agent may be orphaned.",
    inputSchema: withInstance(agentIdOnly),
    handler: passthroughHandler(client, "agents.delete"),
  };

  const filesList: ToolDef = {
    name: "openclaw_agents_files_list",
    description:
      "List files attached to an agent (instructions, system files, etc.). Wraps `agents.files.list`. Read-only.",
    inputSchema: withInstance(agentIdOnly.passthrough()),
    handler: passthroughHandler(client, "agents.files.list"),
  };

  const filesGet: ToolDef = {
    name: "openclaw_agents_files_get",
    description:
      "Fetch a specific agent file's contents (system prompt, tool definitions, etc.). Wraps `agents.files.get`. Read-only. Pass either `path` (full path including the file name) or `name` (file basename) — not both.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().min(1),
        path: z.string().min(1).optional().describe("Full file path (e.g. 'system.md'). Pass either this or `name`."),
        name: z.string().optional().describe("File basename. Pass either this or `path`."),
      })
      .passthrough()),
    handler: passthroughHandler(client, "agents.files.get"),
  };

  const filesSet: ToolDef = {
    name: "openclaw_agents_files_set",
    description:
      "Write or overwrite an agent file. Wraps `agents.files.set`. Destructive — overwrites existing content silently. Pass `agentId`, `path` or `name`, and `content` or `body` (gateway accepts both names depending on version).",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().min(1),
        path: z.string().min(1).optional().describe("Full file path (e.g. 'system.md'). Pass either this or `name`."),
        name: z.string().optional().describe("File basename. Pass either this or `path`."),
        content: z.string().optional().describe("File body. Newer field name."),
        body: z.string().optional().describe("File body. Older alias for `content`; pass either, not both."),
      })
      .passthrough()),
    handler: passthroughHandler(client, "agents.files.set"),
  };

  return [list, create, update, remove, filesList, filesGet, filesSet];
}
