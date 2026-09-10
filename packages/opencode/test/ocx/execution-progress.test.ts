import { describe, expect, it } from "bun:test"
import { ExecutionProgressTracker } from "../../src/ocx/execution-progress"

describe("ExecutionProgressTracker", () => {
  it("tracks monotonic step progression", () => {
    const tracker = new ExecutionProgressTracker([
      { id: "s1", action: "inspect", target: "foo.ts", status: "pending" },
      { id: "s2", action: "mutate", target: "foo.ts", status: "pending" },
      { id: "s3", action: "verify", target: "foo.ts", status: "pending" },
    ])

    const step1 = tracker.completeStep(0)
    expect(step1.completedCount).toBe(1)
    expect(step1.monotonic).toBe(true)
    expect(step1.regressed).toBe(false)

    const step2 = tracker.completeStep(1)
    expect(step2.completedCount).toBe(2)
    expect(step2.monotonic).toBe(true)
    expect(step2.regressed).toBe(false)
  })

  it("detects regression when a completed step is marked as failed", () => {
    const tracker = new ExecutionProgressTracker([
      { id: "s1", action: "inspect", target: "foo.ts", status: "pending" },
      { id: "s2", action: "mutate", target: "foo.ts", status: "pending" },
    ])

    tracker.completeStep(0)
    const failRes = tracker.failStep(0, "test broke")
    expect(failRes.regressed).toBe(true)
    expect(failRes.regressionReason).toContain("test broke")
  })
})
