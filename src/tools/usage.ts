import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildUsageTools(client: ToolClient): ToolDef[] {
  const status: ToolDef = {
    name: "openclaw_usage_status",
    description:
      "Get usage status (token counts, current period, quotas). Wraps `usage.status`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "usage.status"),
  };

  const cost: ToolDef = {
    name: "openclaw_usage_cost",
    description:
      "Get usage cost breakdown (per agent, per model, per period). Wraps `usage.cost`. Read-only. Pass period/agent filters if supported.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().optional(),
        sinceMs: z.number().int().positive().optional(),
        untilMs: z.number().int().positive().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "usage.cost"),
  };

  return [status, cost];
}
