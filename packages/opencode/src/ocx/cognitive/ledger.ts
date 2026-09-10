export type Confidence = "known" | "likely" | "unknown" | "unverified"

export type FactRecord = {
  readonly claim: string
  readonly evidence: string
  readonly confidence: Confidence
}

export type AssumptionRecord = {
  readonly claim: string
  readonly confidence: Confidence
  readonly validationNeeded: boolean
}

export type UnknownRecord = {
  readonly question: string
  readonly whyItMatters: string
}

export type HypothesisRecord = {
  readonly label: string
  readonly status: "primary" | "unlikely" | "unverified" | "rejected"
  readonly evidence: string
}

export type DecisionRecord = {
  readonly decision: string
  readonly alternatives: readonly string[]
  readonly reason: string
  readonly evidence: string
  readonly risk: "low" | "medium" | "high"
  readonly verificationRequired: boolean
}

export type CognitiveLedger = {
  readonly facts: readonly FactRecord[]
  readonly assumptions: readonly AssumptionRecord[]
  readonly unknowns: readonly UnknownRecord[]
  readonly hypotheses: readonly HypothesisRecord[]
  readonly decisions: readonly DecisionRecord[]
}

export function createLedger(): CognitiveLedger {
  return {
    facts: [],
    assumptions: [],
    unknowns: [],
    hypotheses: [],
    decisions: [],
  }
}

export function addFact(ledger: CognitiveLedger, claim: string, evidence: string, confidence: Confidence = "known"): CognitiveLedger {
  return {
    ...ledger,
    facts: [...ledger.facts, { claim, evidence, confidence }],
  }
}

export function addAssumption(ledger: CognitiveLedger, claim: string, confidence: Confidence = "unknown", validationNeeded: boolean = true): CognitiveLedger {
  return {
    ...ledger,
    assumptions: [...ledger.assumptions, { claim, confidence, validationNeeded }],
  }
}

export function addUnknown(ledger: CognitiveLedger, question: string, whyItMatters: string): CognitiveLedger {
  return {
    ...ledger,
    unknowns: [...ledger.unknowns, { question, whyItMatters }],
  }
}

export function addHypothesis(ledger: CognitiveLedger, label: string, status: HypothesisRecord["status"] = "unverified", evidence: string = ""): CognitiveLedger {
  return {
    ...ledger,
    hypotheses: [...ledger.hypotheses, { label, status, evidence }],
  }
}

export function addDecision(ledger: CognitiveLedger, decision: string, alternatives: readonly string[], reason: string, evidence: string, risk: DecisionRecord["risk"] = "medium", verificationRequired: boolean = true): CognitiveLedger {
  return {
    ...ledger,
    decisions: [...ledger.decisions, { decision, alternatives, reason, evidence, risk, verificationRequired }],
  }
}

export function updateHypothesisStatus(ledger: CognitiveLedger, label: string, status: HypothesisRecord["status"]): CognitiveLedger {
  return {
    ...ledger,
    hypotheses: ledger.hypotheses.map((h) => (h.label === label ? { ...h, status } : h)),
  }
}

export function primaryHypothesis(ledger: CognitiveLedger): HypothesisRecord | undefined {
  return ledger.hypotheses.find((h) => h.status === "primary") ?? ledger.hypotheses.find((h) => h.status === "unverified")
}

export function unresolvedQuestions(ledger: CognitiveLedger): readonly UnknownRecord[] {
  return ledger.unknowns
}

export function hasUnverifiedAssumptions(ledger: CognitiveLedger): boolean {
  return ledger.assumptions.some((a) => a.validationNeeded && a.confidence === "unknown")
}

export * as CognitiveLedger from "./ledger"