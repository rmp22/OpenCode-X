import { describe, expect, test } from "bun:test"
import { TechnicalResearchEngine } from "@/ocx/research/pipeline"

describe("TechnicalResearchEngine", () => {
  test("generates multiple query angles", () => {
    const engine = new TechnicalResearchEngine()
    const angles = engine.generateQueryAngles("Effect schedule exponential backoff")
    expect(angles.length).toBe(4)
    expect(angles.some((a) => a.includes("official documentation"))).toBe(true)
  })

  test("synthesizes structured research notes", () => {
    const engine = new TechnicalResearchEngine()
    engine.addSource({
      id: "src-1",
      locator: "https://example.com/docs",
      type: "web_url",
      authority: "official_docs",
      timestamp: Date.now(),
      freshnessScore: 0.95,
      sectionsUsed: ["Schedule.exponential(Duration.millis(100))"],
    })
    engine.addClaim({
      claimId: "cl-1",
      statement: "Schedule.exponential creates backoff schedule",
      supportingSourceIds: ["src-1"],
      supportingSpans: ["Schedule.exponential(Duration.millis(100))"],
      contradictingSourceIds: [],
      uncertainty: "none",
    })

    const note = engine.synthesize({
      id: "top-1",
      title: "Effect Backoff",
      primaryQuestion: "How to configure backoff?",
      subquestions: ["What is Schedule.exponential?"],
    })

    expect(note.topicId).toBe("top-1")
    expect(note.keyFindings.length).toBe(1)
    expect(note.sources.length).toBe(1)
  })
})
