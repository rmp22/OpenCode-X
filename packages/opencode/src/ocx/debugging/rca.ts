import type { FailureClass } from "./failure-classifier"

export interface RootCauseHypothesis {
  id: string
  category: FailureClass
  title: string
  probability: number
  suggestedAction: string
}

export interface ReproductionCase {
  id: string
  testCommand: string
  expectedFailureMessage: string
  capturedAt: number
}

export class AntiFlailViolationError extends Error {
  readonly _tag = "AntiFlailViolationError"
  constructor(public readonly failureSignature: string, public readonly attemptCount: number) {
    super(
      `Anti-flail barrier triggered: ${attemptCount} consecutive unsuccessful fixes for failure signature '${failureSignature}'. Force hypothesis re-evaluation.`,
    )
  }
}

export class AntiFlailBarrier {
  private attemptHistory = new Map<string, number>()
  private maxConsecutiveAttempts: number

  constructor(maxAttempts = 3) {
    this.maxConsecutiveAttempts = maxAttempts
  }

  recordAttempt(signature: string, succeeded: boolean): void {
    if (succeeded) {
      this.attemptHistory.delete(signature)
      return
    }

    const count = (this.attemptHistory.get(signature) ?? 0) + 1
    this.attemptHistory.set(signature, count)

    if (count >= this.maxConsecutiveAttempts) {
      throw new AntiFlailViolationError(signature, count)
    }
  }

  getAttemptCount(signature: string): number {
    return this.attemptHistory.get(signature) ?? 0
  }

  reset(signature?: string): void {
    if (signature) {
      this.attemptHistory.delete(signature)
    } else {
      this.attemptHistory.clear()
    }
  }
}

export function generateHypotheses(trace: string): RootCauseHypothesis[] {
  const lower = trace.toLowerCase()
  const hypotheses: RootCauseHypothesis[] = []

  if (lower.includes("cannot find module") || lower.includes("err_module_not_found")) {
    hypotheses.push({
      id: "hypo-import",
      category: "dependency",
      title: "Missing or invalid module import path",
      probability: 0.9,
      suggestedAction: "Check relative import path and module exports",
    })
  }

  if (lower.includes("typeerror") || lower.includes("is not a function") || lower.includes("cannot read properties of undefined")) {
    hypotheses.push({
      id: "hypo-null-runtime",
      category: "implementation",
      title: "Unchecked null/undefined access or incorrect function invocation",
      probability: 0.85,
      suggestedAction: "Trace nullability boundary and verify caller arguments",
    })
  }

  if (lower.includes("syntaxerror") || lower.includes("unexpected token")) {
    hypotheses.push({
      id: "hypo-syntax",
      category: "implementation",
      title: "Syntax error or mismatched delimiters in source file",
      probability: 0.95,
      suggestedAction: "Inspect cited line number and syntax brackets",
    })
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      id: "hypo-generic",
      category: "implementation",
      title: "Logic or semantic error during execution",
      probability: 0.5,
      suggestedAction: "Run reproduction unit test with debugger or targeted logging",
    })
  }

  return hypotheses.sort((a, b) => b.probability - a.probability)
}

export const defaultAntiFlailBarrier = new AntiFlailBarrier()
