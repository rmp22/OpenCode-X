import { canonicalToolName } from "../graph/router"
import { type GateRecord, mintGate } from "./index"

export type PolicyVerdict = "allow" | "require_approval" | "deny"

export type PolicyDecision =
  | { readonly verdict: "allow"; readonly canonicalToolName?: string }
  | { readonly verdict: "require_approval"; readonly reason: string; readonly gateID?: string; readonly effect?: string }
  | { readonly verdict: "deny"; readonly reason: string }

export interface OperationContext {
  readonly toolName: string
  readonly sessionID?: string
  readonly laneID?: string
  readonly nodeID?: string
  readonly allowedTools?: readonly string[]
  readonly targetPath?: string
  readonly command?: string
  readonly effects?: readonly string[]
}

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+([/~]|\$HOME|\.\.)/i,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*r\s+([/~]|\$HOME|\.\.)/i,
  /git\s+reset\s+--hard/i,
  /git\s+push\s+.*(--force|-f\b)/i,
  /git\s+clean\s+-[a-zA-Z]*f/i,
  /\b(mkfs|dd\s+if=)/i,
  /curl\s+.*\|\s*(bash|sh)\b/i,
  /wget\s+.*\|\s*(bash|sh)\b/i,
]

const PROTECTED_PATHS = ["/etc", "/sys", "/proc", "/boot", "/dev"]

export function evaluateOperationPolicy(ctx: OperationContext): PolicyDecision {
  const canonical = canonicalToolName(ctx.toolName)

  if (ctx.allowedTools !== undefined) {
    if (ctx.allowedTools.length === 0) {
      return {
        verdict: "deny",
        reason: `Tool '${ctx.toolName}' denied: node '${ctx.nodeID ?? "active"}' does not allow any tool invocations`,
      }
    }
    if (!ctx.allowedTools.includes("*")) {
      const allowedCanonicalSet = new Set(ctx.allowedTools.map((t) => canonicalToolName(t)))
      const toolLower = ctx.toolName.toLowerCase()
      if (!allowedCanonicalSet.has(canonical) && !allowedCanonicalSet.has(toolLower)) {
        return {
          verdict: "deny",
          reason: `Tool '${ctx.toolName}' is not permitted in node '${ctx.nodeID ?? "active"}' (allowed: [${ctx.allowedTools.join(", ")}])`,
        }
      }
    }
  }

  if (ctx.command) {
    const trimmedCmd = ctx.command.trim()

    if (/\bsudo\b/i.test(trimmedCmd)) {
      return {
        verdict: "deny",
        reason: "The sudo command is forbidden by security policy; use pkexec with authorized prompts instead.",
      }
    }

    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(trimmedCmd)) {
        return {
          verdict: "require_approval",
          reason: `Destructive command requires explicit user approval: ${trimmedCmd}`,
          effect: "destructive.command",
        }
      }
    }
  }

  if (ctx.targetPath) {
    for (const prefix of PROTECTED_PATHS) {
      if (ctx.targetPath.startsWith(prefix)) {
        return {
          verdict: "deny",
          reason: `Path '${ctx.targetPath}' is a protected system location and cannot be mutated`,
        }
      }
    }
  }

  return {
    verdict: "allow",
    canonicalToolName: canonical,
  }
}

export function mintApprovalGate(options: {
  readonly laneID?: string
  readonly operation: string
  readonly reason: string
  readonly target?: string
}): GateRecord {
  return mintGate({
    laneID: options.laneID ?? "system",
    effect: "blast-radius",
    payload: {
      operation: options.operation,
      reason: options.reason,
      target: options.target,
    },
  })
}

export function mintInterventionRequest(options: {
  readonly laneID?: string
  readonly stallType: "loop_exhausted" | "no_progress" | "ambiguity"
  readonly reason: string
  readonly suggestedActions?: readonly string[]
}): GateRecord {
  return mintGate({
    laneID: options.laneID ?? "system",
    effect: "blast-radius",
    payload: {
      interventionType: options.stallType,
      reason: options.reason,
      suggestedActions: options.suggestedActions ?? [],
    },
  })
}

export * as OperationPolicy from "./policy"
