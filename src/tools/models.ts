import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildModelsTools(client: ToolClient): ToolDef[] {
  const list: ToolDef = {
    name: "openclaw_models_list",
    description:
      "List models available to the gateway (Anthropic, OpenAI, etc.) with their IDs and any provider metadata. Wraps `models.list`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "models.list"),
  };

  return [list];
}
