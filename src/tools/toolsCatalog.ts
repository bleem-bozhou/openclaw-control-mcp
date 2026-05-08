import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildToolsCatalogTools(client: ToolClient): ToolDef[] {
  const catalog: ToolDef = {
    name: "openclaw_tools_catalog",
    description:
      "List the catalog of agent-facing tools available to OpenClaw agents (i.e. what `main` and other agents can call from inside a session). Wraps `tools.catalog`. Read-only.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "tools.catalog"),
  };

  const effective: ToolDef = {
    name: "openclaw_tools_effective",
    description:
      "Get the effective (merged) tool set for an agent — base catalog + skill-provided + per-agent overrides. Wraps `tools.effective`. Read-only.",
    inputSchema: withInstance(z
      .object({
        agentId: z.string().optional(),
        sessionId: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "tools.effective"),
  };

  return [catalog, effective];
}
