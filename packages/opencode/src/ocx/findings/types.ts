export type FindingSeverity = "error" | "warning" | "info"

export type FindingConfidence = "high" | "medium" | "low"

export type FindingEnforcement = "blocking" | "advisory"

export type FindingLifecycleState = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "SUPPRESSED" | "RECURRED"

export type Finding = {
  readonly id: string
  readonly detector: string
  readonly code: string
  readonly severity: FindingSeverity
  readonly confidence: FindingConfidence
  readonly target: string
  readonly sourceRevision?: string | number
  readonly message: string
  readonly evidence?: string
  readonly remediation?: string
  readonly enforcement: FindingEnforcement
  readonly fingerprint: string
  readonly lifecycleState?: FindingLifecycleState
  readonly turnsSeen?: number
  readonly lastSeenTurn?: number
}

export interface FileFindingTrend {
  readonly file: string
  readonly history: readonly number[]
  readonly consecutiveIncreases: number
  readonly isOscillating: boolean
  readonly oscillatingRules: readonly string[]
}

export type DeltaSavingsMetric = {
  readonly totalTokensEstimated: number
  readonly deltaTokensEstimated: number
  readonly tokensSaved: number
  readonly savingsPercent: number
}

export function computeFindingFingerprint(params: {
  readonly detector: string
  readonly code: string
  readonly target: string
  readonly message?: string
}): string {
  const norm = (params.detector + ":" + params.code + ":" + params.target + ":" + (params.message ?? "")).trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < norm.length; i++) {
    hash = (hash << 5) - hash + norm.charCodeAt(i)
    hash |= 0
  }
  const fp = "fp_" + Math.abs(hash).toString(36)
  return fp
}

export function determineEnforcement(
  detector: string,
  code: string,
  confidence: FindingConfidence,
): FindingEnforcement {
  const isCompilerOrParser =
    detector.includes("compiler") ||
    detector.includes("typecheck") ||
    detector.includes("parser") ||
    code.startsWith("TS") ||
    code.startsWith("syntax")

  if (isCompilerOrParser && confidence === "high") {
    return "blocking"
  }
  return "advisory"
}

export * as FindingTypes from "./types"
