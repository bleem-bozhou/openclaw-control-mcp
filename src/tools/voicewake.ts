import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildVoicewakeTools(client: ToolClient): ToolDef[] {
  const get: ToolDef = {
    name: "openclaw_voicewake_get",
    description:
      "Get the voice-wake configuration (wake word, sensitivity, enabled). Wraps `voicewake.get`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "voicewake.get"),
  };

  const set: ToolDef = {
    name: "openclaw_voicewake_set",
    description:
      "Update the voice-wake configuration. Wraps `voicewake.set`.",
    inputSchema: withInstance(z
      .object({
        enabled: z.boolean().optional(),
        wakeWord: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "voicewake.set"),
  };

  return [get, set];
}
