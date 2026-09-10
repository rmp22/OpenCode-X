import type { EvalRunResult, UpliftReport } from "./types"

export class EvalHarness {
  static validateControlledRun(
    baseline: EvalRunResult,
    candidate: EvalRunResult,
  ): { readonly valid: boolean; readonly reason?: string } {
    if (baseline.modelId !== candidate.modelId) {
      const result = {
        valid: false,
        reason: "Invalid controlled evaluation: model IDs must match (" + baseline.modelId + " vs " + candidate.modelId + ")",
      }
      return result
    }
    if (baseline.taskType !== candidate.taskType) {
      const result = {
        valid: false,
        reason: "Invalid controlled evaluation: task types must match (" + baseline.taskType + " vs " + candidate.taskType + ")",
      }
      return result
    }
    const result = { valid: true }
    return result
  }

  static compareArms(
    baseline: EvalRunResult,
    candidate: EvalRunResult,
  ): UpliftReport {
    const check = EvalHarness.validateControlledRun(baseline, candidate)
    if (!check.valid) {
      throw new Error(check.reason)
    }

    const passRateDelta = Math.round((candidate.passRate - baseline.passRate) * 100) / 100
    const requirementCoverageDelta = Math.round((candidate.requirementCoverage - baseline.requirementCoverage) * 100) / 100
    const regressionsDelta = candidate.regressionsCount - baseline.regressionsCount
    const unsupportedClaimsDelta = candidate.unsupportedClaimsCount - baseline.unsupportedClaimsCount
    const toolCallsEfficiencyDelta = baseline.toolCallsTotal - candidate.toolCallsTotal
    const tokensDelta = candidate.tokensConsumed - baseline.tokensConsumed

    const isNetPositive =
      passRateDelta >= 0 &&
      regressionsDelta <= 0 &&
      unsupportedClaimsDelta <= 0 &&
      requirementCoverageDelta >= 0

    const summary = isNetPositive
      ? "Candidate " + candidate.arm + " outperformed baseline with +" + Math.round(passRateDelta * 100) + "% pass rate uplift, " + regressionsDelta + " regressions, and " + unsupportedClaimsDelta + " unsupported claims."
      : "Candidate " + candidate.arm + " failed net-positive criteria."

    const report: UpliftReport = {
      baselineArm: baseline.arm,
      candidateArm: candidate.arm,
      passRateDelta,
      requirementCoverageDelta,
      regressionsDelta,
      unsupportedClaimsDelta,
      toolCallsEfficiencyDelta,
      tokensDelta,
      isNetPositive,
      summary,
    }
    return report
  }
}

export * as EvalHarnessModule from "./harness"
