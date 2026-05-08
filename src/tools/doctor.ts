import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildDoctorTools(client: ToolClient): ToolDef[] {
  const status: ToolDef = {
    name: "openclaw_doctor_memory_status",
    description:
      "Get the memory subsystem health (short-term store, dream diary, grounding state). Wraps `doctor.memory.status`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "doctor.memory.status"),
  };

  const dreamDiary: ToolDef = {
    name: "openclaw_doctor_memory_dreamDiary",
    description:
      "Read the dream diary (the gateway's REM/light dream artifacts that promote into MEMORY.md). Wraps `doctor.memory.dreamDiary`. Read-only.",
    inputSchema: withInstance(z
      .object({
        limit: z.number().int().positive().max(500).optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "doctor.memory.dreamDiary"),
  };

  const backfill: ToolDef = {
    name: "openclaw_doctor_memory_backfillDreamDiary",
    description:
      "Backfill the dream diary from past sessions (re-runs dreaming on history). Wraps `doctor.memory.backfillDreamDiary`. Mutates — can be expensive in tokens.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "doctor.memory.backfillDreamDiary"),
  };

  const dedupe: ToolDef = {
    name: "openclaw_doctor_memory_dedupeDreamDiary",
    description:
      "Deduplicate dream diary entries. Wraps `doctor.memory.dedupeDreamDiary`. Mutates.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "doctor.memory.dedupeDreamDiary"),
  };

  const repair: ToolDef = {
    name: "openclaw_doctor_memory_repairDreamingArtifacts",
    description:
      "Repair corrupted dreaming artifacts (e.g. orphan files, broken JSON). Wraps `doctor.memory.repairDreamingArtifacts`. Mutates.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "doctor.memory.repairDreamingArtifacts"),
  };

  const resetDreamDiary: ToolDef = {
    name: "openclaw_doctor_memory_resetDreamDiary",
    description:
      "Wipe the dream diary entirely. Wraps `doctor.memory.resetDreamDiary`. DESTRUCTIVE — confirm before calling. Loses all promoted-into-memory candidates.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "doctor.memory.resetDreamDiary"),
  };

  const resetGrounded: ToolDef = {
    name: "openclaw_doctor_memory_resetGroundedShortTerm",
    description:
      "Wipe the grounded short-term memory store. Wraps `doctor.memory.resetGroundedShortTerm`. DESTRUCTIVE — agents lose their recent recall.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "doctor.memory.resetGroundedShortTerm"),
  };

  return [status, dreamDiary, backfill, dedupe, repair, resetDreamDiary, resetGrounded];
}
