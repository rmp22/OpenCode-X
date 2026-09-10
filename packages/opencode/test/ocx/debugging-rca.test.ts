import { describe, expect, test } from "bun:test"
import {
  AntiFlailBarrier,
  AntiFlailViolationError,
  generateHypotheses,
} from "@/ocx/debugging/rca"

describe("Debugging RCA & Anti-Flail Barrier", () => {
  test("generates ranked hypotheses from error traces", () => {
    const trace = "Error: Cannot find module './missing'"
    const hypotheses = generateHypotheses(trace)
    expect(hypotheses.length).toBeGreaterThan(0)
    expect(hypotheses[0].category).toBe("dependency")
    expect(hypotheses[0].probability).toBeGreaterThan(0.8)
  })

  test("triggers anti-flail barrier after 3 consecutive failures for same signature", () => {
    const barrier = new AntiFlailBarrier(3)
    const sig = "sig-error-type-1"

    barrier.recordAttempt(sig, false)
    barrier.recordAttempt(sig, false)
    expect(barrier.getAttemptCount(sig)).toBe(2)

    expect(() => {
      barrier.recordAttempt(sig, false)
    }).toThrow(AntiFlailViolationError)
  })

  test("resets attempt count on success", () => {
    const barrier = new AntiFlailBarrier(3)
    const sig = "sig-error-type-2"

    barrier.recordAttempt(sig, false)
    barrier.recordAttempt(sig, true)
    expect(barrier.getAttemptCount(sig)).toBe(0)
  })
})
