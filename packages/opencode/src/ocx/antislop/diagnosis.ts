import type { SemanticNeighborhood } from "./context"
import { evidence } from "./context"
import type { SlopSignal } from "./scanner"
import { matches, type ProjectVocabulary } from "./vocabulary"

export type Diagnosis = {
  readonly artifact: string
  readonly signal: SlopSignal
  readonly evidence: readonly string[]
  readonly diagnosis: string
  readonly proposedRepair?: string
  readonly compatibilityRisk: "low" | "medium" | "high" | "unknown"
  readonly confidence: "low" | "medium" | "high"
}

export type RepairPlan = {
  readonly kind: "semantic-review" | "delete-comment" | "simplify" | "verify-dependency" | "strengthen-test" | "inspect-ui"
  readonly action: string
  readonly automatic: false
  readonly requiresOwnerContext: boolean
  readonly verification: readonly string[]
}

export type DiagnosisInput = {
  readonly signal: SlopSignal
  readonly neighborhood?: SemanticNeighborhood
  readonly vocabulary?: ProjectVocabulary
}

export function diagnose(input: DiagnosisInput): Diagnosis {
  const contextEvidence = input.neighborhood ? evidence(input.neighborhood) : []
  const vocabularyEvidence = input.vocabulary && input.signal.span ? matches(input.vocabulary, input.signal.span) : []
  const diagnosis = rootCause(input.signal, Boolean(input.neighborhood), vocabularyEvidence.length > 0)
  const compatibilityRisk = input.neighborhood?.symbol?.exported ? "high" : input.signal.family === "naming" ? "medium" : "low"
  const confidence = input.neighborhood && contextEvidence.length > 0 ? "high" : input.vocabulary ? "medium" : "low"
  return {
    artifact: input.signal.path ?? input.signal.surface,
    signal: input.signal,
    evidence: [...contextEvidence, ...vocabularyEvidence.map((term) => `project term: ${term}`)],
    diagnosis,
    proposedRepair: repairText(input.signal),
    compatibilityRisk,
    confidence,
  }
}

export function planRepair(diagnosis: Diagnosis): RepairPlan {
  if (diagnosis.signal.family === "naming")
    return {
      kind: "semantic-review",
      action: "inspect the declaration, implementation, callers, external contract, and project vocabulary before proposing a name",
      automatic: false,
      requiresOwnerContext: diagnosis.compatibilityRisk !== "low",
      verification: ["check all symbol references", "check public, protocol, reflection, and serialization compatibility"],
    }
  if (diagnosis.signal.family === "comments")
    return {
      kind: diagnosis.signal.id === "C-restating-code" ? "delete-comment" : "simplify",
      action: diagnosis.signal.action,
      automatic: false,
      requiresOwnerContext: false,
      verification: ["confirm the comment adds no invariant, constraint, workaround, or compatibility fact"],
    }
  if (diagnosis.signal.family === "dependency")
    return {
      kind: "verify-dependency",
      action: "verify the package, version, license, repository equivalent, and actual need before accepting the import",
      automatic: false,
      requiresOwnerContext: true,
      verification: ["check the package manifest", "check the repository's existing platform or helper alternative"],
    }
  if (diagnosis.signal.family === "tests")
    return {
      kind: "strengthen-test",
      action: "assert the required behavior and failure path instead of only mirroring the implementation",
      automatic: false,
      requiresOwnerContext: true,
      verification: ["run the focused test", "include the relevant negative or boundary case"],
    }
  if (diagnosis.signal.family === "frontend")
    return {
      kind: "inspect-ui",
      action: "compare the changed surface with the product content, design system, accessibility states, and responsive behavior",
      automatic: false,
      requiresOwnerContext: false,
      verification: ["check loading, error, empty, keyboard, focus, reduced-motion, and intermediate viewport states"],
    }
  return {
    kind: "simplify",
    action: diagnosis.signal.action,
    automatic: false,
    requiresOwnerContext: false,
    verification: ["run the smallest relevant behavior check"],
  }
}

export function diagnoseMany(signals: readonly SlopSignal[], input: Omit<DiagnosisInput, "signal"> = {}): Diagnosis[] {
  return signals.map((signal) => diagnose({ ...input, signal }))
}

function rootCause(signal: SlopSignal, hasContext: boolean, hasVocabulary: boolean): string {
  if (signal.family === "naming")
    return hasContext || hasVocabulary
      ? "the identifier shape needs comparison with observed behavior and established project terms"
      : "the identifier may narrate implementation details because its domain meaning is not yet established"
  if (signal.family === "comments") return "the comment may add ceremony without information that the code or contract lacks"
  if (signal.family === "prose") return "the wording may hide the factual payload behind a generic or surface-inappropriate template"
  if (signal.family === "structure") return "the change may introduce responsibility or abstraction boundaries without repository evidence"
  if (signal.family === "dependency") return "the dependency choice has not yet been checked against the repository contract and existing facilities"
  if (signal.family === "tests") return "the test may prove that code exists instead of proving the required behavior"
  return "the signal indicates a possible quality gap that requires context before repair"
}

function repairText(signal: SlopSignal): string | undefined {
  if (signal.family === "naming") return "resolve the observable meaning first; do not generate a replacement from the flagged words"
  if (signal.family === "comments" && signal.id === "C-restating-code") return "remove the redundant comment after checking for hidden invariants"
  return signal.action
}

export * as SemanticResolver from "./diagnosis"
export * as RepairPlanner from "./diagnosis"
