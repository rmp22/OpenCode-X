export type FailureClass =
  | "implementation"
  | "test"
  | "environment"
  | "dependency"
  | "permission"
  | "flaky"
  | "stale"
  | "unknown"

export type FailureClassificationResult = {
  readonly classification: FailureClass
  readonly confidence: "high" | "medium" | "low"
  readonly allowProductMutation: boolean
  readonly reason: string
}

export function classifyFailure(error: {
  readonly message: string
  readonly exitCode?: number
  readonly stdout?: string
  readonly stderr?: string
}): FailureClassificationResult {
  const combined = (error.message + "\n" + (error.stdout ?? "") + "\n" + (error.stderr ?? "")).toLowerCase()

  if (
    combined.includes("eacces") ||
    combined.includes("eperm") ||
    combined.includes("permission denied") ||
    combined.includes("operation not permitted")
  ) {
    const result: FailureClassificationResult = {
      classification: "permission",
      confidence: "high",
      allowProductMutation: false,
      reason: "Failure caused by filesystem or OS permissions; do not mutate product code",
    }
    return result
  }

  if (
    combined.includes("econnrefused") ||
    combined.includes("enotfound") ||
    combined.includes("command not found") ||
    combined.includes("missing environment variable") ||
    combined.includes("docker daemon not running") ||
    combined.includes("port already in use") ||
    combined.includes("no such file or directory: /bin/")
  ) {
    const result: FailureClassificationResult = {
      classification: "environment",
      confidence: "high",
      allowProductMutation: false,
      reason: "Failure caused by missing environment service or tool; do not mutate product code",
    }
    return result
  }

  if (
    combined.includes("err_module_not_found") ||
    combined.includes("cannot find module") ||
    combined.includes("modulenotfounderror") ||
    combined.includes("unresolved dependency")
  ) {
    const result: FailureClassificationResult = {
      classification: "dependency",
      confidence: "high",
      allowProductMutation: false,
      reason: "Failure caused by missing or unresolved external dependency",
    }
    return result
  }

  if (
    combined.includes("assertionerror") ||
    combined.includes("expect(") ||
    combined.includes("received:") ||
    combined.includes("tests failed") ||
    combined.includes("1 fail")
  ) {
    const result: FailureClassificationResult = {
      classification: "test",
      confidence: "high",
      allowProductMutation: true,
      reason: "Test expectation failure; verify logic and apply targeted fix",
    }
    return result
  }

  if (
    combined.includes("typeerror") ||
    combined.includes("referenceerror") ||
    combined.includes("syntaxerror") ||
    combined.includes("error ts") ||
    combined.includes("null pointer")
  ) {
    const result: FailureClassificationResult = {
      classification: "implementation",
      confidence: "high",
      allowProductMutation: true,
      reason: "Code implementation error in target source",
    }
    return result
  }

  if (combined.includes("etimedout") || combined.includes("socket hang up")) {
    const result: FailureClassificationResult = {
      classification: "flaky",
      confidence: "medium",
      allowProductMutation: false,
      reason: "Transient socket or timing failure; do not prematurely alter logic",
    }
    return result
  }

  const result: FailureClassificationResult = {
    classification: "unknown",
    confidence: "low",
    allowProductMutation: true,
    reason: "Unclassified failure; gather discriminating evidence before speculative edit",
  }
  return result
}

export * as FailureClassifierModule from "./failure-classifier"
