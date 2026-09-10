import { describe, expect, test } from "bun:test"
import { AttentionSinkManager } from "@/ocx/attention"

describe("Attention Sink Manager", () => {
  test("registers, queries, and removes anchors", () => {
    const manager = new AttentionSinkManager()

    manager.registerAnchor({
      id: "a1",
      type: "constraint",
      content: "Do not add comments",
      priority: "critical",
      placement: "prefix",
    })

    const found = manager.getAnchor("a1")
    expect(found).toBeDefined()
    expect(found?.content).toBe("Do not add comments")

    manager.removeAnchor("a1")
    expect(manager.getAnchor("a1")).toBeUndefined()
  })

  test("sorts anchors by priority weight and filters by criteria", () => {
    const manager = new AttentionSinkManager()

    manager.registerAnchor({
      id: "med",
      type: "objective",
      content: "Minor goal",
      priority: "medium",
      placement: "prefix",
    })
    manager.registerAnchor({
      id: "crit",
      type: "constraint",
      content: "Never violate safety",
      priority: "critical",
      placement: "prefix",
    })
    manager.registerAnchor({
      id: "high",
      type: "invariant",
      content: "All tests must pass",
      priority: "high",
      placement: "prefix",
    })
    manager.registerAnchor({
      id: "suffix_crit",
      type: "stage_transition",
      content: "Final step",
      priority: "critical",
      placement: "suffix",
    })

    const prefixSorted = manager.getAnchors({ placement: "prefix" })
    expect(prefixSorted.length).toBe(3)
    expect(prefixSorted[0].id).toBe("crit")
    expect(prefixSorted[1].id).toBe("high")
    expect(prefixSorted[2].id).toBe("med")

    const highOrAbove = manager.getAnchors({ minPriority: "high" })
    expect(highOrAbove.length).toBe(3)
    expect(highOrAbove.map((a) => a.id)).not.toContain("med")
  })

  test("refreshes attention on stage transitions with active objectives", () => {
    const manager = new AttentionSinkManager()

    const transitionAnchor = manager.refreshOnStageTransition("analyze", "mutate", [
      "Create policy-tiers.ts",
      "Run typecheck",
    ])

    expect(transitionAnchor.type).toBe("stage_transition")
    expect(transitionAnchor.priority).toBe("critical")
    expect(transitionAnchor.placement).toBe("suffix")
    expect(transitionAnchor.stage).toBe("mutate")
    expect(transitionAnchor.content).toContain("TRANSITION [analyze -> mutate]")
    expect(transitionAnchor.content).toContain("Create policy-tiers.ts")
  })

  test("injects sink markers with prefix, boundary, and suffix blocks", () => {
    const manager = new AttentionSinkManager()

    manager.registerAnchor({
      id: "p1",
      type: "constraint",
      content: "Top-level constraint",
      priority: "critical",
      placement: "prefix",
    })
    manager.registerAnchor({
      id: "s1",
      type: "objective",
      content: "Final check objective",
      priority: "high",
      placement: "suffix",
    })

    const result = manager.injectSinkMarkers("Main context body")

    expect(result.prefixAnchorsCount).toBe(1)
    expect(result.suffixAnchorsCount).toBe(1)
    expect(result.boundaryAnchorsCount).toBe(0)

    expect(result.assembledContent.startsWith("=== ATTENTION SINK: PREFIX ANCHORS ===")).toBe(true)
    expect(result.assembledContent).toContain("Main context body")
    expect(result.assembledContent).toContain("=== ATTENTION SINK: SUFFIX ANCHORS ===")
  })

  test("formats anchor text consistently and supports clearing", () => {
    const manager = new AttentionSinkManager()
    const anchor = {
      id: "test",
      type: "constraint" as const,
      content: "No any allowed",
      priority: "critical" as const,
      placement: "prefix" as const,
    }

    const formatted = manager.formatAnchorText(anchor)
    expect(formatted).toBe("[CONSTRAINT:CRITICAL] No any allowed")

    manager.registerAnchor(anchor)
    expect(manager.getAnchors().length).toBe(1)

    manager.clear()
    expect(manager.getAnchors().length).toBe(0)
  })
})
