import type { StrategyName } from "@/ocx/strategy"

export const CORE_STRATEGIES: readonly StrategyName[] = ["quality", "engineering"]

export const KNOWN_INTENTS = ["code", "design", "research", "debug", "refactor", "documentation", "review", "plan", "git"] as const
export type Intent = (typeof KNOWN_INTENTS)[number]

export function intakePassBlock(): string {
  return [
    "=== OCX INTAKE PASS ===",
    "call ocx_header with one wrapper string containing the topic and a workflow hint before exploring or modifying files.",
    "The header records intent context only. The runtime owns workflow state, operation policy, and evidence.",
    "Call ocx_plan only when the current request needs execution tracking; do not create a coding plan for documentation, research, explanation, or review-only work.",
    "The runtime owns plan status and mirrors it into the todo UI. Do not maintain a second plan with todowrite.",
    "Workflow and phase guide sequencing; scope, approvals, and policy decide whether an operation is allowed. A workflow or phase mismatch is not permission to probe an alternate execution surface.",
    "=== END OCX INTAKE PASS ===",
  ].join("\n")
}

export * as OCXHeuristics from "./heuristics"
