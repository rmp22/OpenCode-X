import { describe, expect, test } from "bun:test"
import {
  SourceCoverageTracker,
  BlindMutationError,
  DecisionRegistry,
} from "@/ocx/decision"

describe("SourceCoverageTracker", () => {
  test("prohibits blind mutations before file has been read", () => {
    const tracker = new SourceCoverageTracker()
    expect(() => {
      tracker.assertCanMutate("src/foo.ts")
    }).toThrow(BlindMutationError)

    tracker.recordRead("src/foo.ts", { linesCount: 100 })
    expect(tracker.hasRead("src/foo.ts")).toBe(true)
    expect(() => {
      tracker.assertCanMutate("src/foo.ts")
    }).not.toThrow()
  })
})

describe("DecisionRegistry", () => {
  test("records and retrieves architectural decisions", () => {
    const registry = new DecisionRegistry()
    const record = registry.recordDecision({
      id: "dec-1",
      title: "Use Content-Addressable Evidence Store",
      rationale: "Ensures tamper-proof immutability",
      alternativesConsidered: ["In-memory list", "SQLite table only"],
      chosenAlternative: "Content-Addressable SHA-256 store",
      invariants: ["Immutability", "Deterministic hashing"],
    })

    expect(record.id).toBe("dec-1")
    expect(registry.getDecision("dec-1")?.chosenAlternative).toBe("Content-Addressable SHA-256 store")
    expect(registry.getAllDecisions()).toHaveLength(1)
  })
})
