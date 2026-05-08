import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildWizardTools(client: ToolClient): ToolDef[] {
  const start: ToolDef = {
    name: "openclaw_wizard_start",
    description:
      "Start a setup wizard flow (e.g. agent onboarding, channel pairing). Wraps `wizard.start`. Pass the wizard id / kind.",
    inputSchema: withInstance(z
      .object({
        kind: z.string().optional(),
        id: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "wizard.start"),
  };

  const next: ToolDef = {
    name: "openclaw_wizard_next",
    description:
      "Advance the active wizard to its next step (with the user's answer to the current step). Wraps `wizard.next`.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "wizard.next"),
  };

  const cancel: ToolDef = {
    name: "openclaw_wizard_cancel",
    description:
      "Cancel the active wizard flow without applying its changes. Wraps `wizard.cancel`.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "wizard.cancel"),
  };

  const status: ToolDef = {
    name: "openclaw_wizard_status",
    description:
      "Get the active wizard's current step and pending input. Wraps `wizard.status`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "wizard.status"),
  };

  return [start, next, cancel, status];
}
