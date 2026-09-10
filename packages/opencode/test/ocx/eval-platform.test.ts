import { describe, expect, test } from "bun:test"

export interface EvalRunResult {
  runId: string
  taskName: string
  pass: boolean
  tokensUsed: number
  durationMs: number
  failureReason?: string
}

export class ControlledEvaluationPlatform {
  private results: EvalRunResult[] = []

  recordRun(result: EvalRunResult): void {
    this.results.push(result)
  }

  getSummary(): { totalRuns: number; passRate: number; avgDurationMs: number; avgTokens: number } {
    if (this.results.length === 0) {
      return { totalRuns: 0, passRate: 0, avgDurationMs: 0, avgTokens: 0 }
    }
    const passed = this.results.filter((r) => r.pass).length
    const totalDuration = this.results.reduce((acc, r) => acc + r.durationMs, 0)
    const totalTokens = this.results.reduce((acc, r) => acc + r.tokensUsed, 0)

    return {
      totalRuns: this.results.length,
      passRate: passed / this.results.length,
      avgDurationMs: Math.round(totalDuration / this.results.length),
      avgTokens: Math.round(totalTokens / this.results.length),
    }
  }
}

describe("Controlled Evaluation Platform", () => {
  test("records evaluation runs and computes aggregate statistics", () => {
    const platform = new ControlledEvaluationPlatform()

    platform.recordRun({
      runId: "run-1",
      taskName: "streaming-hot-path",
      pass: true,
      tokensUsed: 1500,
      durationMs: 300,
    })

    platform.recordRun({
      runId: "run-2",
      taskName: "retry-backoff",
      pass: true,
      tokensUsed: 2100,
      durationMs: 500,
    })

    platform.recordRun({
      runId: "run-3",
      taskName: "memory-compaction",
      pass: false,
      tokensUsed: 4000,
      durationMs: 1200,
      failureReason: "token budget exceeded",
    })

    const summary = platform.getSummary()
    expect(summary.totalRuns).toBe(3)
    expect(summary.passRate).toBeCloseTo(0.67, 1)
    expect(summary.avgDurationMs).toBeGreaterThan(0)
    expect(summary.avgTokens).toBeGreaterThan(0)
  })
})
