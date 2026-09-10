import { describe, expect, test } from "bun:test"
import { Metrics } from "@/ocx/metrics"

const record = (fields: Record<string, unknown>) =>
  JSON.stringify({
    time: Date.now(),
    sessionID: "s",
    tier: "standard",
    ...fields,
  })

describe("aggregate", () => {
  test("counts records, clean closes, and blocked closes", () => {
    const summary = Metrics.aggregate([
      record({ round: 1, findings: [] }),
      record({ round: 3, findings: [{ id: "C6-todo-open" }] }),
      record({ round: 2, findings: [] }),
      "{not json",
    ])
    expect(summary.records).toBe(3)
    expect(summary.closedClean).toBe(2)
    expect(summary.blocked).toBe(1)
  })

  test("builds descending top-findings histogram capped at eight", () => {
    const lines = [
      record({ findings: [{ id: "A" }, { id: "B" }, { id: "B" }, { id: "C" }] }),
      record({ findings: [{ id: "B" }, { id: "C" }] }),
    ]
    const summary = Metrics.aggregate(lines)
    expect(summary.topFindings[0]).toEqual({ id: "B", count: 3 })
    expect(summary.topFindings[1]).toEqual({ id: "C", count: 2 })
    expect(summary.topFindings.length).toBeLessThanOrEqual(8)
  })

  test("median rounds handles odd and even sample counts", () => {
    const odd = Metrics.aggregate([record({ round: 1 }), record({ round: 2 }), record({ round: 9 })])
    expect(odd.medianRounds).toBe(2)
    const even = Metrics.aggregate([
      record({ round: 1 }),
      record({ round: 2 }),
      record({ round: 9 }),
      record({ round: 12 }),
    ])
    expect(even.medianRounds).toBe(5.5)
  })

  test("averages ladder milliseconds ignoring records without ladder data", () => {
    const summary = Metrics.aggregate([
      record({ round: 1, findings: [], ladder: { ms: 1000, executed: 2, failed: 0 } }),
      record({ round: 1, findings: [], ladder: { ms: 3000, executed: 1, failed: 1 } }),
      record({ round: 1, findings: [] }),
    ])
    expect(summary.avgLadderMs).toBe(2000)
  })

  test("tolerates null array fields and non-finite rounds", () => {
    const summary = Metrics.aggregate([record({ round: "two", findings: "nope" })])
    expect(summary.records).toBe(1)
    expect(summary.closedClean).toBe(0)
    expect(summary.blocked).toBe(0)
    expect(summary.topFindings).toEqual([])
  })

  test("aggregates practice pack hits and recurring proposals", () => {
    const summary = Metrics.aggregate([
      record({ practice: { hits: ["testing-doctrine", "review-checklist"], proposals: ["one"] } }),
      record({ practice: { hits: ["testing-doctrine"], proposals: ["two", "three"] } }),
    ])
    expect(summary.practiceHitPacks).toEqual([
      { id: "testing-doctrine", count: 2 },
      { id: "review-checklist", count: 1 },
    ])
    expect(summary.practiceProposals).toBe(3)
  })

  test("aggregates count-only style outcomes and categories", () => {
    const style = {
      mode: "rewrite_prose",
      outcome: "pass_after_rewrite",
      reviewCount: 2,
      rewriteCount: 1,
      retryCount: 1,
      violationCategories: ["plain_language", "filler"],
      inputChars: 100,
      outputChars: 80,
      latencyMs: 20,
      invalidReviewerJson: 1,
      protectedSpanViolation: false,
    }
    const unavailable = {
      mode: "enforce",
      outcome: "review_unavailable",
      reviewCount: 1,
      rewriteCount: 0,
      retryCount: 1,
      violationCategories: [],
      inputChars: 200,
      outputChars: 0,
      latencyMs: 40,
      invalidReviewerJson: 1,
      protectedSpanViolation: true,
    }
    const summary = Metrics.aggregate([record({ style }), record({ style: unavailable })])

    expect(summary.style).toEqual({
      reviewPass: 1,
      reviewFail: 1,
      rewriteCandidates: 1,
      rewriteApplied: 1,
      verificationPass: 1,
      verificationFail: 0,
      hardBlock: 0,
      reviewUnavailable: 1,
      invalidReviewerJson: 2,
      protectedSpanViolation: 1,
      violationCategories: [
        { id: "filler", count: 1 },
        { id: "plain_language", count: 1 },
      ],
      avgInputChars: 150,
      avgOutputChars: 40,
      avgLatencyMs: 30,
    })
  })
})
