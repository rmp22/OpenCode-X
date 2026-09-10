import type { ScopeLevel, ReevaluationEvent, RequestIntent } from "./types"

export type ReevaluationInput = {
  readonly currentScope: ScopeLevel
  readonly intent: RequestIntent
  readonly newEvidence: readonly string[]
  readonly discoveryTrigger: ReevaluationTrigger
}

export type ReevaluationTrigger =
  | "new_shared_state"
  | "duplicate_defect"
  | "interface_change_required"
  | "lifecycle_issue"
  | "concurrency_issue"
  | "test_reveals_wider_behavior"
  | "root_cause_hypothesis_invalidated"
  | "new_dependency_found"
  | "same_defect_elsewhere"
  | "shared_invariant_discovered"
  | "architecture_involved"
  | "tests_expose_broader_behavior"
  | "root_cause_hypothesis_changed"

export type ReevaluationResult = {
  readonly newScope: ScopeLevel
  readonly action: "keep" | "widen" | "narrow" | "continue_exploration"
  readonly reason: string
  readonly event: ReevaluationEvent
}

const ESCALATION_TRIGGERS: readonly ReevaluationTrigger[] = [
  "new_shared_state",
  "duplicate_defect",
  "interface_change_required",
  "lifecycle_issue",
  "concurrency_issue",
  "test_reveals_wider_behavior",
  "root_cause_hypothesis_invalidated",
  "new_dependency_found",
  "same_defect_elsewhere",
  "shared_invariant_discovered",
  "architecture_involved",
  "tests_expose_broader_behavior",
  "root_cause_hypothesis_changed",
]

const WIDEN_TRIGGERS: readonly ReevaluationTrigger[] = [
  "new_shared_state",
  "duplicate_defect",
  "interface_change_required",
  "lifecycle_issue",
  "concurrency_issue",
  "test_reveals_wider_behavior",
  "same_defect_elsewhere",
  "shared_invariant_discovered",
  "architecture_involved",
  "tests_expose_broader_behavior",
]

const NARROW_TRIGGERS: readonly ReevaluationTrigger[] = [
  "root_cause_hypothesis_invalidated",
  "root_cause_hypothesis_changed",
]

function nextScopeLevel(current: ScopeLevel, direction: "widen" | "narrow"): ScopeLevel {
  const levels: ScopeLevel[] = ["local", "component", "feature", "subsystem", "structural"]
  const index = levels.indexOf(current)
  if (direction === "widen") {
    return levels[Math.min(index + 1, levels.length - 1)]
  }
  return levels[Math.max(index - 1, 0)]
}

export function reevaluateScope(input: ReevaluationInput): ReevaluationResult {
  const trigger = input.discoveryTrigger

  if (!ESCALATION_TRIGGERS.includes(trigger)) {
    return {
      newScope: input.currentScope,
      action: "keep",
      reason: `Trigger "${trigger}" does not require scope change`,
      event: {
        oldScope: input.currentScope,
        newScope: input.currentScope,
        evidence: input.newEvidence,
        reason: `Trigger "${trigger}" does not require scope change`,
      },
    }
  }

  if (WIDEN_TRIGGERS.includes(trigger)) {
    const newScope = nextScopeLevel(input.currentScope, "widen")
    return {
      newScope,
      action: newScope === input.currentScope ? "keep" : "widen",
      reason: `Trigger "${trigger}" indicates wider scope is needed`,
      event: {
        oldScope: input.currentScope,
        newScope,
        evidence: input.newEvidence,
        reason: `Trigger "${trigger}" indicates wider scope is needed`,
      },
    }
  }

  if (NARROW_TRIGGERS.includes(trigger)) {
    const newScope = nextScopeLevel(input.currentScope, "narrow")
    return {
      newScope,
      action: newScope === input.currentScope ? "keep" : "narrow",
      reason: `Trigger "${trigger}" indicates narrower scope is sufficient`,
      event: {
        oldScope: input.currentScope,
        newScope,
        evidence: input.newEvidence,
        reason: `Trigger "${trigger}" indicates narrower scope is sufficient`,
      },
    }
  }

  return {
    newScope: input.currentScope,
    action: "continue_exploration",
    reason: `Trigger "${trigger}" requires continued exploration before scope decision`,
    event: {
      oldScope: input.currentScope,
      newScope: input.currentScope,
      evidence: input.newEvidence,
      reason: `Trigger "${trigger}" requires continued exploration before scope decision`,
    },
  }
}

export * as ScopeReevaluationHook from "./reevaluation-hook"
