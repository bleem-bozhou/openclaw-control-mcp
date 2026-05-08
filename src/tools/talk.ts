import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildTalkTools(client: ToolClient): ToolDef[] {
  const config: ToolDef = {
    name: "openclaw_talk_config",
    description:
      "Get / set the talk-mode config (push-to-talk, hold-to-listen, voice activity detection). Wraps `talk.config`.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "talk.config"),
  };

  const mode: ToolDef = {
    name: "openclaw_talk_mode",
    description:
      "Get / set the active talk mode (e.g. continuous, manual). Wraps `talk.mode`.",
    inputSchema: withInstance(z
      .object({
        mode: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "talk.mode"),
  };

  const speak: ToolDef = {
    name: "openclaw_talk_speak",
    description:
      "Make the agent speak a piece of text out loud (synthesizes + plays). Wraps `talk.speak`.",
    inputSchema: withInstance(z
      .object({
        text: z.string().min(1),
      })
      .passthrough()),
    handler: passthroughHandler(client, "talk.speak"),
  };

  return [config, mode, speak];
}
