import { CognitiveLedger } from "./ledger"

export type ControllerState = {
  readonly phase: string
  readonly ledger: CognitiveLedger
  readonly stuckDetected: boolean
  readonly stuckReason?: string
  readonly strategyLevel: number
  readonly alternativeCount: number
  readonly verificationState: "unverified" | "partial" | "verified"
  readonly completionClaim: string
  readonly evidenceForCompletion: readonly string[]
}

export type AlternativeApproach = {
  readonly name: string
  readonly description: string
  readonly correctnessRisk: "low" | "medium" | "high"
  readonly changeSize: "small" | "medium" | "large"
  readonly architectureFit: "good" | "fair" | "poor"
  readonly maintainability: "high" | "medium" | "low"
  readonly testability: "high" | "medium" | "low"
}

const STUCK_THRESHOLDS = {
  repeatedFailedCommand: 3,
  repeatedReadPath: 2,
  repeatedEditPath: 3,
  sameHypothesisNoProgress: 3,
}

export function createState(phase: string): ControllerState {
  return {
    phase,
    ledger: CognitiveLedger.createLedger(),
    stuckDetected: false,
    strategyLevel: 1,
    alternativeCount: 0,
    verificationState: "unverified",
    completionClaim: "",
    evidenceForCompletion: [],
  }
}

export function setPhase(state: ControllerState, phase: string): ControllerState {
  return { ...state, phase }
}

export function recordFact(state: ControllerState, claim: string, evidence: string, confidence?: "known" | "likely" | "unknown" | "unverified"): ControllerState {
  return {
    ...state,
    ledger: CognitiveLedger.addFact(state.ledger, claim, evidence, confidence),
  }
}

export function recordAssumption(state: ControllerState, claim: string, confidence?: "known" | "likely" | "unknown" | "unverified", validationNeeded?: boolean): ControllerState {
  return {
    ...state,
    ledger: CognitiveLedger.addAssumption(state.ledger, claim, confidence, validationNeeded),
  }
}

export function recordUnknown(state: ControllerState, question: string, whyItMatters: string): ControllerState {
  return {
    ...state,
    ledger: CognitiveLedger.addUnknown(state.ledger, question, whyItMatters),
  }
}

export function recordHypothesis(state: ControllerState, label: string, status?: "primary" | "unlikely" | "unverified" | "rejected", evidence?: string): ControllerState {
  return {
    ...state,
    ledger: CognitiveLedger.addHypothesis(state.ledger, label, status, evidence),
  }
}

export function recordDecision(state: ControllerState, decision: string, alternatives: readonly string[], reason: string, evidence: string, risk?: "low" | "medium" | "high", verificationRequired?: boolean): ControllerState {
  return {
    ...state,
    ledger: CognitiveLedger.addDecision(state.ledger, decision, alternatives, reason, evidence, risk, verificationRequired),
  }
}

export function updateHypothesis(state: ControllerState, label: string, status: "primary" | "unlikely" | "unverified" | "rejected"): ControllerState {
  return {
    ...state,
    ledger: CognitiveLedger.updateHypothesisStatus(state.ledger, label, status),
  }
}

export function setVerificationState(state: ControllerState, verificationState: "unverified" | "partial" | "verified"): ControllerState {
  return { ...state, verificationState }
}

export function setCompletionClaim(state: ControllerState, claim: string, evidence: readonly string[]): ControllerState {
  return { ...state, completionClaim: claim, evidenceForCompletion: evidence }
}

export function detectStuck(state: ControllerState, entries: readonly { kind: string; path?: string; command?: string; outcome?: string }[]): ControllerState {
  const commands = entries.filter((e) => e.kind === "command")
  const repeatedCommand = commands.length >= STUCK_THRESHOLDS.repeatedFailedCommand &&
    commands.slice(-STUCK_THRESHOLDS.repeatedFailedCommand).every((e) => e.outcome === "failed" && e.command === commands.at(-1)?.command)
  if (repeatedCommand) {
    return {
      ...state,
      stuckDetected: true,
      stuckReason: `the same failed command was repeated ${STUCK_THRESHOLDS.repeatedFailedCommand} times: ${commands.at(-1)?.command}`,
      strategyLevel: state.strategyLevel + 1,
    }
  }

  const reads = entries.filter((e) => e.kind === "read")
  const readTail = reads.slice(-STUCK_THRESHOLDS.repeatedReadPath)
  const repeatedRead = readTail.length === STUCK_THRESHOLDS.repeatedReadPath && readTail.every((e) => e.path === readTail[0]?.path)
  if (repeatedRead) {
    return {
      ...state,
      stuckDetected: true,
      stuckReason: `the same path was read repeatedly: ${readTail[0]?.path}`,
      strategyLevel: state.strategyLevel + 1,
    }
  }

  const edits = entries.filter((e) => e.kind === "edit")
  const editTail = edits.slice(-STUCK_THRESHOLDS.repeatedEditPath)
  const repeatedEdit = editTail.length === STUCK_THRESHOLDS.repeatedEditPath && editTail.every((e) => e.path === editTail[0]?.path)
  if (repeatedEdit) {
    return {
      ...state,
      stuckDetected: true,
      stuckReason: `equivalent edits repeat on ${editTail[0]?.path}`,
      strategyLevel: state.strategyLevel + 1,
    }
  }

  return { ...state, stuckDetected: false }
}

export function alternativeStrategies(state: ControllerState): readonly AlternativeApproach[] {
  const hypotheses = state.ledger.hypotheses
  const primary = hypotheses.find((h) => h.status === "primary") ?? hypotheses.find((h) => h.status === "unverified")

  if (!primary) return []

  const alternatives: AlternativeApproach[] = []

  if (primary.status === "unverified" || primary.status === "primary") {
    alternatives.push({
      name: "minimal-fix",
      description: "Make the smallest possible change to address the root cause",
      correctnessRisk: "low",
      changeSize: "small",
      architectureFit: "good",
      maintainability: "high",
      testability: "high",
    })
  }

  if (primary.status === "unverified") {
    alternatives.push({
      name: "refactor-approach",
      description: "Refactor the surrounding code to make the fix more natural",
      correctnessRisk: "medium",
      changeSize: "medium",
      architectureFit: "fair",
      maintainability: "medium",
      testability: "medium",
    })
  }

  alternatives.push({
    name: "deferred-investigation",
    description: "Add instrumentation and investigate before changing code",
    correctnessRisk: "low",
    changeSize: "small",
    architectureFit: "good",
    maintainability: "high",
    testability: "high",
  })

  return alternatives
}

export function externalTaskState(
  task: string,
  phase: string,
  ledger: CognitiveLedger,
): { task: string; phase: string; ledger: CognitiveLedger; timestamp: number } {
  return { task, phase, ledger, timestamp: Date.now() }
}

export function simplify(state: ControllerState): ControllerState {
  return {
    ...state,
    ledger: {
      ...state.ledger,
      hypotheses: state.ledger.hypotheses.filter((h) => h.status !== "rejected"),
    },
  }
}

export function challengePremises(state: ControllerState): readonly string[] {
  const premises: string[] = []
  if (state.ledger.assumptions.some((a) => a.confidence === "unknown" && a.validationNeeded)) {
    premises.push("important assumption may be wrong: unverified assumption exists")
  }
  if (state.ledger.unknowns.length > 0) {
    premises.push(`unresolved questions exist: ${state.ledger.unknowns.map((u) => u.question).join("; ")}`)
  }
  if (state.ledger.hypotheses.every((h) => h.status === "rejected")) {
    premises.push("all hypotheses have been rejected; reconsider the problem framing")
  }
  return premises
}

export function epistemicCalibration(state: ControllerState): { known: number; likely: number; unknown: number; unverified: number } {
  const facts = state.ledger.facts
  return {
    known: facts.filter((f) => f.confidence === "known").length,
    likely: facts.filter((f) => f.confidence === "likely").length,
    unknown: facts.filter((f) => f.confidence === "unknown").length,
    unverified: facts.filter((f) => f.confidence === "unverified").length,
  }
}

export function counterexampleSearch(state: ControllerState): readonly string[] {
  const checks: string[] = []
  if (state.ledger.facts.length === 0) {
    checks.push("no facts recorded yet; verify the solution against the actual problem")
  }
  if (state.ledger.assumptions.some((a) => a.confidence === "unknown")) {
    checks.push("unverified assumptions could invalidate the solution")
  }
  if (state.ledger.hypotheses.some((h) => h.status === "unverified")) {
    checks.push("unverified hypotheses remain; test them")
  }
  return checks
}

export * as CognitiveController from "./controller"