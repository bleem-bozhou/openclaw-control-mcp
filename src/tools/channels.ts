import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildChannelsTools(client: ToolClient): ToolDef[] {
  const status: ToolDef = {
    name: "openclaw_channels_status",
    description:
      "Get the connection status of delivery channels (Telegram, email, etc.). Wraps `channels.status`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "channels.status"),
  };

  const logout: ToolDef = {
    name: "openclaw_channels_logout",
    description:
      "Log out / disconnect a delivery channel. Wraps `channels.logout`. Destructive — channel won't deliver until re-authenticated. Pass the channel name (e.g. 'telegram').",
    inputSchema: withInstance(z
      .object({
        channel: z.string().min(1).describe("Channel name, e.g. 'telegram'"),
      })
      .passthrough()),
    handler: passthroughHandler(client, "channels.logout"),
  };

  return [status, logout];
}
