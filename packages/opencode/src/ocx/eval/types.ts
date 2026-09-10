export type EvalArmKind =
  | "baseline_off"
  | "ocx_full"
  | "ablation_no_ladder"
  | "ablation_no_loops"
  | "ablation_no_evidence"

export type EvalTaskType = "coding" | "research"

export type EvalRunResult = {
  readonly runId: string
  readonly arm: EvalArmKind
  readonly taskType: EvalTaskType
  readonly modelId: string
  readonly passRate: number
  readonly requirementCoverage: number
  readonly regressionsCount: number
  readonly architectureScore: number
  readonly unsupportedClaimsCount: number
  readonly toolCallsTotal: number
  readonly tokensConsumed: number
  readonly latencyMs: number
  readonly recoverySuccessCount: number
}

export type UpliftReport = {
  readonly baselineArm: EvalArmKind
  readonly candidateArm: EvalArmKind
  readonly passRateDelta: number
  readonly requirementCoverageDelta: number
  readonly regressionsDelta: number
  readonly unsupportedClaimsDelta: number
  readonly toolCallsEfficiencyDelta: number
  readonly tokensDelta: number
  readonly isNetPositive: boolean
  readonly summary: string
}

export type MeasurementProvenance =
  | { readonly kind: "unmeasured" }
  | { readonly kind: "calibration_prior"; readonly note: string }
  | { readonly kind: "empirical"; readonly runId: string; readonly date: string; readonly sampleCount: number }

export * as EvalTypes from "./types"
