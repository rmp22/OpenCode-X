import { describe, expect, test } from "bun:test"
import {
  openSubagentActivity,
  completeSubagentActivity,
  propagateParentCancellation,
  activeLeases,
  clearAll,
} from "../../src/ocx/activity/runtime"

describe("Owner and Subagent Activity Integration", () => {
  test("subagent activity creates distinct child lease and parent delegation lease", () => {
    clearAll()
    const parentSessionID = "parent-ses-1"
    const childSessionID = "child-ses-1"

    const childLease = openSubagentActivity(
      childSessionID,
      parentSessionID,
      "explore",
      "Finding search call sites",
    )

    expect(childLease.sessionID).toBe(childSessionID)
    expect(childLease.parentSessionID).toBe(parentSessionID)
    expect(childLease.subagentType).toBe("explore")

    const parentLeases = activeLeases(parentSessionID)
    expect(parentLeases.length).toBe(1)
    expect(parentLeases[0].title).toContain("Delegated to explore")
  })

  test("subagent lifecycle completes child and updates parent delegation status", () => {
    clearAll()
    const parentSessionID = "parent-ses-2"
    const childSessionID = "child-ses-2"

    openSubagentActivity(
      childSessionID,
      parentSessionID,
      "general",
      "Running refactor step",
    )

    completeSubagentActivity(childSessionID, parentSessionID, true, "Refactor verified")

    const childActive = activeLeases(childSessionID)
    expect(childActive.length).toBe(0)

    const parentActive = activeLeases(parentSessionID)
    expect(parentActive.length).toBe(0)
  })

  test("parent cancellation propagates to all active child subagents", () => {
    clearAll()
    const parentSessionID = "parent-ses-3"
    const child1 = "child-ses-3a"
    const child2 = "child-ses-3b"

    openSubagentActivity(child1, parentSessionID, "explore", "task 1")
    openSubagentActivity(child2, parentSessionID, "explore", "task 2")

    const cancelled = propagateParentCancellation(parentSessionID)
    expect(cancelled).toContain(child1)
    expect(cancelled).toContain(child2)

    expect(activeLeases(child1).length).toBe(0)
    expect(activeLeases(child2).length).toBe(0)
  })
})
