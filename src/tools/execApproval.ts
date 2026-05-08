import { z } from "zod";
import { passthroughHandler, withInstance, type ToolClient } from "./client.js";
import type { ToolDef } from "./cron.js";

export function buildExecApprovalTools(client: ToolClient): ToolDef[] {
  const list: ToolDef = {
    name: "openclaw_exec_approval_list",
    description:
      "List pending and recent exec approvals (commands the agent wants to run that need a human OK). Wraps `exec.approval.list`. Read-only.",
    inputSchema: withInstance(z
      .object({
        status: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "exec.approval.list"),
  };

  const get: ToolDef = {
    name: "openclaw_exec_approval_get",
    description:
      "Get details of a specific exec approval request (command, args, agent, status). Wraps `exec.approval.get`. Read-only.",
    inputSchema: withInstance(z
      .object({
        id: z.string().min(1).describe("Exec approval request id"),
      })
      .passthrough()),
    handler: passthroughHandler(client, "exec.approval.get"),
  };

  const request: ToolDef = {
    name: "openclaw_exec_approval_request",
    description:
      "Submit a new exec approval request (programmatic; normally agents do this themselves). Wraps `exec.approval.request`.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "exec.approval.request"),
  };

  const resolve: ToolDef = {
    name: "openclaw_exec_approval_resolve",
    description:
      "Resolve (approve / reject) a pending exec approval. Wraps `exec.approval.resolve`. Mutates — the agent will proceed (or not) based on this decision.",
    inputSchema: withInstance(z
      .object({
        id: z.string().min(1).describe("Exec approval request id"),
        decision: z.enum(["approve", "reject", "deny"]).optional(),
        approved: z.boolean().optional(),
        reason: z.string().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "exec.approval.resolve"),
  };

  const waitDecision: ToolDef = {
    name: "openclaw_exec_approval_waitDecision",
    description:
      "Block until an exec approval gets a decision (or timeout). Wraps `exec.approval.waitDecision`. Long-running — bounded by the request timeout.",
    inputSchema: withInstance(z
      .object({
        id: z.string().min(1).describe("Exec approval request id"),
        timeoutMs: z.number().int().positive().optional(),
      })
      .passthrough()),
    handler: passthroughHandler(client, "exec.approval.waitDecision"),
  };

  const approvalsGet: ToolDef = {
    name: "openclaw_exec_approvals_get",
    description:
      "Get the global exec approvals policy (auto-allow rules, defaults). Wraps `exec.approvals.get`. Read-only.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "exec.approvals.get"),
  };

  const approvalsSet: ToolDef = {
    name: "openclaw_exec_approvals_set",
    description:
      "Set / replace the global exec approvals policy. Wraps `exec.approvals.set`. Destructive — overwrites the existing policy.",
    inputSchema: withInstance(z.object({}).passthrough()),
    handler: passthroughHandler(client, "exec.approvals.set"),
  };

  const approvalsNodeGet: ToolDef = {
    name: "openclaw_exec_approvals_node_get",
    description:
      "Get the per-node exec approvals policy override. Wraps `exec.approvals.node.get`. Read-only.",
    inputSchema: withInstance(z
      .object({
        nodeId: z.string().min(1).describe("Node id"),
      })
      .passthrough()),
    handler: passthroughHandler(client, "exec.approvals.node.get"),
  };

  const approvalsNodeSet: ToolDef = {
    name: "openclaw_exec_approvals_node_set",
    description:
      "Set the exec approvals policy for a specific node. Wraps `exec.approvals.node.set`. Destructive.",
    inputSchema: withInstance(z
      .object({
        nodeId: z.string().min(1).describe("Node id"),
      })
      .passthrough()),
    handler: passthroughHandler(client, "exec.approvals.node.set"),
  };

  return [
    list,
    get,
    request,
    resolve,
    waitDecision,
    approvalsGet,
    approvalsSet,
    approvalsNodeGet,
    approvalsNodeSet,
  ];
}
