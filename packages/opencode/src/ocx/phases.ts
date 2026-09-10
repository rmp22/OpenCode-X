
const MUTATION_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit", "apply_patch", "task"])

export type AgenticPhase =
  | "orient"
  | "hypothesize"
  | "mutate"
  | "evaluate"
  | "converge"
  | "signoff"

export const AGENTIC_PHASES: readonly AgenticPhase[] = [
  "orient",
  "hypothesize",
  "mutate",
  "evaluate",
  "converge",
  "signoff",
]

export function isAgenticPhase(phase: string): phase is AgenticPhase {
  return AGENTIC_PHASES.includes(phase.toLowerCase() as AgenticPhase)
}

export interface PhaseCapabilityDefinition {
  readonly phase: AgenticPhase
  readonly allowedTools?: readonly string[]
  readonly blockedTools?: readonly string[]
}

export const DEFAULT_PHASE_CAPABILITIES: Record<AgenticPhase, PhaseCapabilityDefinition> = {
  orient: {
    phase: "orient",
    blockedTools: ["edit", "write", "multiedit", "notebookedit", "apply_patch"],
  },
  hypothesize: {
    phase: "hypothesize",
    blockedTools: ["edit", "write", "multiedit", "notebookedit", "apply_patch"],
  },
  mutate: {
    phase: "mutate",
  },
  evaluate: {
    phase: "evaluate",
  },
  converge: {
    phase: "converge",
    blockedTools: ["edit", "write", "multiedit", "notebookedit", "apply_patch"],
  },
  signoff: {
    phase: "signoff",
    blockedTools: ["edit", "write", "multiedit", "notebookedit", "apply_patch", "task"],
  },
}

export function filterToolsForCapability<T extends Record<string, unknown>>(
  tools: T,
  phase: AgenticPhase | string,
  opts?: {
    readonly allowedTools?: readonly string[]
    readonly blockedTools?: readonly string[]
    readonly gated?: boolean
  },
): T {
  if (opts?.gated === false) return tools
  const normalized = phase.toLowerCase()
  const capability = isAgenticPhase(normalized) ? DEFAULT_PHASE_CAPABILITIES[normalized] : undefined
  const blocked = new Set<string>()
  if (capability?.blockedTools) {
    for (const tool of capability.blockedTools) blocked.add(tool.toLowerCase())
  }
  if (opts?.blockedTools) {
    for (const tool of opts.blockedTools) blocked.add(tool.toLowerCase())
  }
  const explicitAllowed = opts?.allowedTools?.map((t) => t.toLowerCase()) ?? capability?.allowedTools?.map((t) => t.toLowerCase())

  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(tools)) {
    const lower = name.toLowerCase()
    if (explicitAllowed && !explicitAllowed.includes(lower)) continue
    if (blocked.has(lower)) continue
    out[name] = value
  }
  return out as T
}

export function applyPhaseGate<T extends Record<string, unknown>>(
  tools: T,
  opts: { gated: boolean },
): T {
  if (!opts.gated) return tools
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(tools)) {
    if (MUTATION_TOOLS.has(name.toLowerCase())) continue
    out[name] = value
  }
  return out as T
}

export function isMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(name.toLowerCase())
}

export * as Phases from "./phases"
