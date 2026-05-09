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
      "Toggle talk mode on/off. Wraps `talk.mode`. Wire format (verified live against gateway 2026.4.12+): requires `enabled: boolean` — this is a SETTER, not a getter. Use `openclaw_talk_config` to read the current state.",
    inputSchema: withInstance(z
      .object({
        enabled: z.boolean().describe("True to turn talk mode on, false to turn it off."),
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
