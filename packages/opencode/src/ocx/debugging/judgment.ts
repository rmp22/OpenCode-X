export type Hypothesis = {
  readonly id: string
  readonly statement: string
  readonly status: "active" | "eliminated" | "confirmed"
  readonly discriminatingCheck?: string
  readonly evidenceId?: string
  readonly eliminationReason?: string
}

export type DebuggingState = {
  readonly symptom: string
  readonly reproduction?: string
  readonly facts: readonly string[]
  readonly hypotheses: readonly Hypothesis[]
  readonly diagnosis?: string
  readonly repairPlan?: string
  readonly validationCheck?: string
}

export function createDebuggingState(options: {
  readonly symptom: string
  readonly reproduction?: string
  readonly facts?: readonly string[]
  readonly hypotheses?: readonly Hypothesis[]
}): DebuggingState {
  const state: DebuggingState = {
    symptom: options.symptom,
    reproduction: options.reproduction,
    facts: options.facts ?? [],
    hypotheses: options.hypotheses ?? [],
  }
  return state
}

export function confirmHypothesis(
  state: DebuggingState,
  hypothesisId: string,
  evidenceId: string,
  diagnosis: string,
): DebuggingState {
  const updatedHypotheses = state.hypotheses.map((h) => {
    if (h.id === hypothesisId) {
      const confirmed: Hypothesis = {
        ...h,
        status: "confirmed",
        evidenceId,
      }
      return confirmed
    }
    if (h.status === "active") {
      const eliminated: Hypothesis = {
        ...h,
        status: "eliminated",
        eliminationReason: "Superseded by confirmed root cause hypothesis " + hypothesisId,
      }
      return eliminated
    }
    return h
  })

  const updatedState: DebuggingState = {
    ...state,
    hypotheses: updatedHypotheses,
    diagnosis,
  }
  return updatedState
}

export function eliminateHypothesis(
  state: DebuggingState,
  hypothesisId: string,
  reason: string,
): DebuggingState {
  const updatedHypotheses = state.hypotheses.map((h) => {
    if (h.id === hypothesisId) {
      const eliminated: Hypothesis = {
        ...h,
        status: "eliminated",
        eliminationReason: reason,
      }
      return eliminated
    }
    return h
  })

  const updatedState: DebuggingState = {
    ...state,
    hypotheses: updatedHypotheses,
  }
  return updatedState
}

export function canProceedToRepair(state: DebuggingState): {
  readonly allowed: boolean
  readonly reason?: string
} {
  if (state.diagnosis && state.diagnosis.trim().length > 0) {
    const hasConfirmed = state.hypotheses.some((h) => h.status === "confirmed" && h.evidenceId)
    if (hasConfirmed || state.hypotheses.length === 0) {
      const result = { allowed: true }
      return result
    }
  }

  const activeHypotheses = state.hypotheses.filter((h) => h.status === "active")
  if (activeHypotheses.length > 1) {
    const result = {
      allowed: false,
      reason: "Uncertainty is material: " + activeHypotheses.length + " active hypotheses remain without discriminating evidence. Run a discriminating check before mutating code.",
    }
    return result
  }

  if (activeHypotheses.length === 1 && !state.diagnosis) {
    const result = {
      allowed: false,
      reason: "Hypothesis '" + activeHypotheses[0].statement + "' has not been confirmed with discriminating evidence.",
    }
    return result
  }

  const result = { allowed: true }
  return result
}

export * as EngineeringJudgmentModule from "./judgment"
