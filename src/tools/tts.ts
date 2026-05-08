import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildTtsTools(client: ToolClient): ToolDef[] {
  const status: ToolDef = {
    name: "openclaw_tts_status",
    description:
      "Get the TTS subsystem status (enabled, current provider, voice). Wraps `tts.status`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "tts.status"),
  };

  const enable: ToolDef = {
    name: "openclaw_tts_enable",
    description: "Enable text-to-speech output. Wraps `tts.enable`.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "tts.enable"),
  };

  const disable: ToolDef = {
    name: "openclaw_tts_disable",
    description: "Disable text-to-speech output. Wraps `tts.disable`.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "tts.disable"),
  };

  const providers: ToolDef = {
    name: "openclaw_tts_providers",
    description:
      "List available TTS providers (and their voices / models). Wraps `tts.providers`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "tts.providers"),
  };

  const setProvider: ToolDef = {
    name: "openclaw_tts_setProvider",
    description:
      "Switch the active TTS provider / voice. Wraps `tts.setProvider`.",
    inputSchema: withInstance(z
      .object({
        provider: z.string().min(1),
        voice: z.string().optional(),
        model: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "tts.setProvider"),
  };

  const convert: ToolDef = {
    name: "openclaw_tts_convert",
    description:
      "Synthesize a piece of text to audio. Wraps `tts.convert`. Returns audio / a download URL depending on the gateway config.",
    inputSchema: withInstance(z
      .object({
        text: z.string().min(1),
        voice: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "tts.convert"),
  };

  return [status, enable, disable, providers, setProvider, convert];
}
