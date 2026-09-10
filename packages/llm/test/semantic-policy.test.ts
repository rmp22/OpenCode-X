import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { RecoveryDecision, SemanticTaskKind, StructureNeed } from "../src/semantic/schemas"

describe("semantic policy schemas", () => {
  test("accepts non-coding task kinds", () => {
    expect(Schema.decodeUnknownSync(SemanticTaskKind)("research")).toBe("research")
    expect(Schema.decodeUnknownSync(SemanticTaskKind)("automation")).toBe("automation")
    expect(Schema.decodeUnknownSync(SemanticTaskKind)("mixed")).toBe("mixed")
  })

  test("structure is an explicit recommendation rather than a workflow prerequisite", () => {
    const result = Schema.decodeUnknownSync(StructureNeed)({ needed: false, reasons: ["isolated edit"] })
    expect(result.needed).toBe(false)
  })

  test("recovery decisions distinguish retry from alternate actions", () => {
    const result = Schema.decodeUnknownSync(RecoveryDecision)({
      actionClass: "inspect",
      shouldRetry: false,
      correctedAction: "inspect the in-scope directory",
    })
    expect(result.shouldRetry).toBe(false)
    expect(result.actionClass).toBe("inspect")
  })
})

test("quality review schema supports contextual API and UI concerns", async () => {
  const { QualityReview } = await import("../src/semantic/schemas")
  const result = Schema.decodeUnknownSync(QualityReview)({
    verdict: "review",
    concerns: [{
      category: "api_fit",
      severity: "warning",
      evidence: "new wrapper duplicates the existing session boundary",
      recommendation: "reuse the existing boundary",
    }],
  })
  expect(result.concerns[0]?.category).toBe("api_fit")
})

test("design direction schema captures composition and task-specific anti-patterns", async () => {
  const { DesignDirection } = await import("../src/semantic/schemas")
  const result = Schema.decodeUnknownSync(DesignDirection)({
    productType: "developer tool",
    audience: "engineers",
    primaryTask: "inspect agent work",
    density: "high",
    visualCharacter: ["technical", "quiet"],
    layoutStrategy: ["persistent task rail", "large work surface"],
    typographyRoles: ["compact UI sans", "mono for code and commands"],
    surfaceStrategy: ["borders for grouping", "elevation only for overlays"],
    motionPurpose: ["state transitions only"],
    referenceTraits: ["IDE information density"],
    antiPatterns: ["marketing hero", "floating glass cards"],
  })
  expect(result.density).toBe("high")
  expect(result.antiPatterns).toContain("floating glass cards")
})
