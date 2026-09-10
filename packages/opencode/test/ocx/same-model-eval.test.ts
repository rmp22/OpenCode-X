import { describe, expect, test } from "bun:test"
import { EvalHarness, type EvalRunResult } from "@/ocx/eval"

describe("Controlled Same-Model Evaluation Harness", () => {
  const baselineRun: EvalRunResult = {
    runId: "run_base_1",
    arm: "baseline_off",
    taskType: "coding",
    modelId: "google/gemini-3.8-flash",
    passRate: 0.65,
    requirementCoverage: 0.7,
    regressionsCount: 2,
    architectureScore: 0.6,
    unsupportedClaimsCount: 4,
    toolCallsTotal: 42,
    tokensConsumed: 18000,
    latencyMs: 25000,
    recoverySuccessCount: 0,
  }

  const candidateRun: EvalRunResult = {
    runId: "run_ocx_full_1",
    arm: "ocx_full",
    taskType: "coding",
    modelId: "google/gemini-3.8-flash",
    passRate: 0.95,
    requirementCoverage: 1.0,
    regressionsCount: 0,
    architectureScore: 0.95,
    unsupportedClaimsCount: 0,
    toolCallsTotal: 28,
    tokensConsumed: 12000,
    latencyMs: 19000,
    recoverySuccessCount: 3,
  }

  test("validates same-model and same-task-type controls", () => {
    const validCheck = EvalHarness.validateControlledRun(baselineRun, candidateRun)
    expect(validCheck.valid).toBe(true)

    const mismatchedModel: EvalRunResult = {
      ...candidateRun,
      modelId: "anthropic/claude-3-5-sonnet",
    }
    const invalidCheck = EvalHarness.validateControlledRun(baselineRun, mismatchedModel)
    expect(invalidCheck.valid).toBe(false)
    expect(invalidCheck.reason).toContain("model IDs must match")

    const mismatchedTask: EvalRunResult = {
      ...candidateRun,
      taskType: "research",
    }
    const invalidTaskCheck = EvalHarness.validateControlledRun(baselineRun, mismatchedTask)
    expect(invalidTaskCheck.valid).toBe(false)
    expect(invalidTaskCheck.reason).toContain("task types must match")
  })

  test("calculates accurate uplift report and verifies net-positive candidate", () => {
    const report = EvalHarness.compareArms(baselineRun, candidateRun)
    expect(report.passRateDelta).toBe(0.3)
    expect(report.requirementCoverageDelta).toBe(0.3)
    expect(report.regressionsDelta).toBe(-2)
    expect(report.unsupportedClaimsDelta).toBe(-4)
    expect(report.toolCallsEfficiencyDelta).toBe(14)
    expect(report.tokensDelta).toBe(-6000)
    expect(report.isNetPositive).toBe(true)
    expect(report.summary).toContain("+30% pass rate uplift")
  })

  test("detects when ablation underperforms or introduces regressions", () => {
    const regressedAblation: EvalRunResult = {
      runId: "run_ablation_1",
      arm: "ablation_no_ladder",
      taskType: "coding",
      modelId: "google/gemini-3.8-flash",
      passRate: 0.55,
      requirementCoverage: 0.6,
      regressionsCount: 3,
      architectureScore: 0.5,
      unsupportedClaimsCount: 5,
      toolCallsTotal: 50,
      tokensConsumed: 22000,
      latencyMs: 30000,
      recoverySuccessCount: 0,
    }

    const report = EvalHarness.compareArms(baselineRun, regressedAblation)
    expect(report.isNetPositive).toBe(false)
    expect(report.passRateDelta).toBe(-0.1)
    expect(report.regressionsDelta).toBe(1)
    expect(report.summary).toContain("failed net-positive criteria")
  })
})
