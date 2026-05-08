import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildSkillsTools(client: ToolClient): ToolDef[] {
  const status: ToolDef = {
    name: "openclaw_skills_status",
    description:
      "Get the skills subsystem status (which skills are installed, enabled, recently updated). Wraps `skills.status`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "skills.status"),
  };

  const search: ToolDef = {
    name: "openclaw_skills_search",
    description:
      "Search the available skill catalog (installed and remote). Wraps `skills.search`. Read-only.",
    inputSchema: withInstance(z
      .object({
        query: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "skills.search"),
  };

  const detail: ToolDef = {
    name: "openclaw_skills_detail",
    description:
      "Get detailed info on a specific skill (manifest, version, dependencies, install state). Wraps `skills.detail`. Read-only.",
    inputSchema: withInstance(z
      .object({
        id: z.string().min(1).describe("Skill id / slug"),
      })
      .passthrough()),
    handler: passthroughHandler(client, "skills.detail"),
  };

  const install: ToolDef = {
    name: "openclaw_skills_install",
    description:
      "Install a skill (or a specific version). Wraps `skills.install`. Mutates the gateway's skill set — confirm before calling.",
    inputSchema: withInstance(z
      .object({
        id: z.string().min(1).describe("Skill id to install"),
        version: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "skills.install"),
  };

  const update: ToolDef = {
    name: "openclaw_skills_update",
    description:
      "Update an installed skill to its latest (or a specified) version. Wraps `skills.update`. Mutates the gateway state.",
    inputSchema: withInstance(z
      .object({
        id: z.string().min(1).describe("Skill id to update"),
        version: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "skills.update"),
  };

  const bins: ToolDef = {
    name: "openclaw_skills_bins",
    description:
      "List the binaries / executables exposed by installed skills. Wraps `skills.bins`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "skills.bins"),
  };

  return [status, search, detail, install, update, bins];
}
