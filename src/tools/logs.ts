import { z } from "zod";
import { splitInstance, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

type LogLine = {
  _meta?: { date?: string; logLevelName?: string };
  time?: string;
  // The gateway packs the log message into the "1" key (positional logger arg).
  "1"?: unknown;
  [k: string]: unknown;
};

function parseLine(raw: string): LogLine | null {
  try {
    return JSON.parse(raw) as LogLine;
  } catch {
    return null;
  }
}

function lineTimestampMs(line: LogLine): number | null {
  const date = line._meta?.date ?? line.time;
  if (typeof date !== "string") return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : null;
}

export function buildLogsTools(client: ToolClient): ToolDef[] {
  const tail: ToolDef = {
    name: "openclaw_logs_tail",
    description:
      "Tail recent gateway logs. Wraps `logs.tail`. Read-only. The gateway only forwards `limit` to the wire; `sinceMs`, `level`, and `component` are applied client-side AFTER fetch (verified live: the gateway rejects them with `unexpected property` against 2026.4.12+). For wide tails, raise `limit` and the client filters on the way back. Use this for debug — e.g. tracing why a cron job failed, why a session aborted, or what an agent emitted.",
    inputSchema: withInstance(z
      .object({
        limit: z.number().int().positive().max(2000).optional().describe("Forwarded to the gateway. Number of lines to fetch before client-side filtering."),
        sinceMs: z.number().int().positive().optional().describe("Client-side filter: keep entries with `_meta.date` >= sinceMs (epoch ms)."),
        level: z.string().optional().describe("Client-side filter on `_meta.logLevelName` (case-insensitive). Common values: 'INFO', 'WARN', 'ERROR'."),
        component: z.string().optional().describe("Client-side filter: keep entries whose message text contains this substring (case-insensitive). Useful for narrowing to a subsystem (e.g. 'discord', 'cron', 'gateway/ws')."),
      })),
    handler: async (args) => {
      const { rest, opts } = splitInstance(args);
      const { limit, sinceMs, level, component } = rest as {
        limit?: number;
        sinceMs?: number;
        level?: string;
        component?: string;
      };
      const rpcArgs: Record<string, unknown> = {};
      if (limit !== undefined) rpcArgs.limit = limit;
      const result = (await client.request("logs.tail", rpcArgs, opts)) as {
        lines?: string[];
        [k: string]: unknown;
      };
      if (!Array.isArray(result?.lines)) return result;
      // No filters → return verbatim.
      if (sinceMs === undefined && !level && !component) return result;

      const levelUpper = level?.toUpperCase();
      const componentLower = component?.toLowerCase();
      const filtered: string[] = [];
      let dropped = 0;
      for (const raw of result.lines) {
        const parsed = parseLine(raw);
        if (!parsed) {
          // Unparseable line — keep it only if no filters demand structure.
          if (sinceMs === undefined && !levelUpper) {
            if (componentLower && raw.toLowerCase().includes(componentLower)) filtered.push(raw);
            else if (!componentLower) filtered.push(raw);
            else dropped++;
          } else {
            dropped++;
          }
          continue;
        }
        if (sinceMs !== undefined) {
          const t = lineTimestampMs(parsed);
          if (t === null || t < sinceMs) {
            dropped++;
            continue;
          }
        }
        if (levelUpper && parsed._meta?.logLevelName?.toUpperCase() !== levelUpper) {
          dropped++;
          continue;
        }
        if (componentLower) {
          const text = String(parsed["1"] ?? "");
          if (!text.toLowerCase().includes(componentLower)) {
            dropped++;
            continue;
          }
        }
        filtered.push(raw);
      }
      return {
        ...result,
        lines: filtered,
        clientFilter: { sinceMs, level, component, kept: filtered.length, dropped },
      };
    },
  };

  return [tail];
}
