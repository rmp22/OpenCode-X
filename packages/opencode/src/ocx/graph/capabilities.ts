import type { GraphNode } from "./types"

export type CapabilityProfileName = "PLANNING" | "EXECUTION" | "VERIFICATION" | "AUDIT"

export type NodePermissions = {
  readonly canRead: boolean
  readonly canWrite: boolean
  readonly canExecute: boolean
}

export type CapabilityProfile = {
  readonly name: CapabilityProfileName
  readonly allowedTools: readonly string[]
  readonly deniedTools: readonly string[]
  readonly tokenBudget: number
  readonly permissions: NodePermissions
}

export const CAPABILITY_PROFILES: Record<CapabilityProfileName, CapabilityProfile> = {
  PLANNING: {
    name: "PLANNING",
    allowedTools: [
      "read",
      "glob",
      "grep",
      "websearch",
      "webfetch",
      "todowrite",
      "ocx_context",
      "ocx_codebase",
      "ocx_plan",
      "ocx_header",
      "question",
    ],
    deniedTools: ["write", "edit", "bash"],
    tokenBudget: 15000,
    permissions: {
      canRead: true,
      canWrite: false,
      canExecute: false,
    },
  },
  EXECUTION: {
    name: "EXECUTION",
    allowedTools: ["*"],
    deniedTools: [],
    tokenBudget: 50000,
    permissions: {
      canRead: true,
      canWrite: true,
      canExecute: true,
    },
  },
  VERIFICATION: {
    name: "VERIFICATION",
    allowedTools: [
      "read",
      "glob",
      "grep",
      "bash",
      "todowrite",
      "ocx_context",
      "ocx_codebase",
      "question",
    ],
    deniedTools: ["write", "edit"],
    tokenBudget: 20000,
    permissions: {
      canRead: true,
      canWrite: false,
      canExecute: true,
    },
  },
  AUDIT: {
    name: "AUDIT",
    allowedTools: [
      "read",
      "glob",
      "grep",
      "todowrite",
      "ocx_context",
      "ocx_render",
      "ocx_codebase",
      "question",
    ],
    deniedTools: ["write", "edit", "bash"],
    tokenBudget: 10000,
    permissions: {
      canRead: true,
      canWrite: false,
      canExecute: false,
    },
  },
}

export function profileForPhase(phase: string): CapabilityProfile {
  const normalized = phase.toLowerCase()
  if (normalized.includes("plan") || normalized.includes("discover") || normalized.includes("spec")) {
    return CAPABILITY_PROFILES.PLANNING
  }
  if (normalized.includes("verify") || normalized.includes("test") || normalized.includes("check")) {
    return CAPABILITY_PROFILES.VERIFICATION
  }
  if (normalized.includes("audit") || normalized.includes("deliver") || normalized.includes("review")) {
    return CAPABILITY_PROFILES.AUDIT
  }
  return CAPABILITY_PROFILES.EXECUTION
}

export function isToolAllowed(
  node: Pick<GraphNode, "allowedTools" | "deniedTools">,
  toolName: string,
): { readonly allowed: boolean; readonly reason?: string } {
  const lowerName = toolName.toLowerCase()

  if (node.deniedTools && node.deniedTools.some((d) => d.toLowerCase() === lowerName || d === "*")) {
    const deniedDecision = {
      allowed: false,
      reason: `Tool "${toolName}" is explicitly denied in current node capabilities`,
    }
    return deniedDecision
  }

  if (node.allowedTools !== undefined) {
    const allowsAll = node.allowedTools.includes("*")
    const explicitlyAllowed = node.allowedTools.some((a) => a.toLowerCase() === lowerName)
    if (!allowsAll && !explicitlyAllowed) {
      const disallowedDecision = {
        allowed: false,
        reason: `Tool "${toolName}" is not permitted in current node capabilities (allowed: ${node.allowedTools.join(", ")})`,
      }
      return disallowedDecision
    }
  }

  const allowedDecision = { allowed: true }
  return allowedDecision
}

export function isBudgetExceeded(consumed: number, budget?: number): boolean {
  if (budget === undefined || budget <= 0) return false
  return consumed >= budget
}

export function renderCapabilityNotice(node: GraphNode): string {
  const parts = [
    `=== NODE CAPABILITIES: ${node.label} (${node.kind}) ===`,
    node.allowedTools ? `ALLOWED TOOLS: ${node.allowedTools.join(", ")}` : "ALLOWED TOOLS: *",
    node.deniedTools && node.deniedTools.length > 0 ? `DENIED TOOLS: ${node.deniedTools.join(", ")}` : undefined,
    node.tokenBudget ? `TOKEN BUDGET: ${node.tokenBudget}` : undefined,
    "=== END NODE CAPABILITIES ===",
  ].filter(Boolean)
  const rendered = parts.join("\n")
  return rendered
}

export * as GraphCapabilities from "./capabilities"
