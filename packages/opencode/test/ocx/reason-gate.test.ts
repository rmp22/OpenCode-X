import { describe, expect, test } from "bun:test"
import { ReasonGate } from "../../src/ocx/reason-gate"

describe("reason gate arithmetic claims", () => {
  test("flags incorrect integer arithmetic", () => {
    const body = "The retry budget is 17 * 23 = 381 requests, and 100 / 4 = 20 per shard."
    const findings = ReasonGate.arithmeticFindings(body)
    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.id === "R1-arithmetic-slip")).toBe(true)
    expect(findings[0].message).toContain("computes to 391")
  })

  test("passes correct arithmetic including dates and negatives", () => {
    const body = "That is 128 * 256 = 32768 ops; 2026 - 2020 = 6 years; 5 - 8 = -3 net."
    expect(ReasonGate.arithmeticFindings(body)).toEqual([])
  })

  test("ignores version-style decimals instead of false-flagging them", () => {
    const body = "Bump from 2.10 + 0.1 = 2.11 to the next minor."
    expect(ReasonGate.arithmeticFindings(body)).toEqual([])
  })

  test("dedupes repeated wrong spans and caps at three findings", () => {
    const claim = "9 * 9 = 82"
    const body = Array.from({ length: 6 }, () => claim).join(", plus ")
    const findings = ReasonGate.arithmeticFindings(body)
    expect(findings).toHaveLength(1)
  })

  test("returns empty for no arithmetic", () => {
    expect(ReasonGate.arithmeticFindings("Refactor done. Tests are green.")).toEqual([])
  })
})

describe("reason gate shipped reversals", () => {
  test("flags two or more explicit self-reversals", () => {
    const body =
      "Use approach A. Wait, no, that breaks caching. Scratch that, approach B handles it. Never mind, B also fails; back to A with a guard."
    const findings = ReasonGate.reversalFindings(body)
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe("R2-shipped-reversal")
    expect(findings[0].span).toContain("3 reversals")
  })

  test("stays silent for one reversal or ordinary contrast phrasing", () => {
    expect(ReasonGate.reversalFindings("Never mind the naming; keep it.")).toEqual([])
    expect(
      ReasonGate.reversalFindings("On one hand caching helps latency. On the other hand it complicates invalidation."),
    ).toEqual([])
  })

  test("returns empty for empty input", () => {
    expect(ReasonGate.reversalFindings("")).toEqual([])
    expect(ReasonGate.arithmeticFindings("")).toEqual([])
  })
})
