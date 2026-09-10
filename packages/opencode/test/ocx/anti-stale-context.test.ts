import { describe, expect, test } from "bun:test"
import { AntiStaleContextTracker } from "@/ocx/attention"

describe("Anti-Stale Context Tracker", () => {
  test("records epistemic facts with inferred and explicit statuses", () => {
    const tracker = new AntiStaleContextTracker()

    const factWithEvidence = tracker.recordFact({
      id: "f1",
      claim: "Function foo returns 42",
      turnObserved: 1,
      evidence: "Verified in test suite",
    })
    expect(factWithEvidence.status).toBe("known")

    const factWithoutEvidence = tracker.recordFact({
      id: "f2",
      claim: "Function bar might throw",
      turnObserved: 1,
    })
    expect(factWithoutEvidence.status).toBe("assumed")

    const explicitFact = tracker.recordFact({
      id: "f3",
      claim: "Config exists",
      status: "known",
      turnObserved: 2,
    })
    expect(explicitFact.status).toBe("known")
  })

  test("invalidates facts when a file mutation occurs after fact observation", () => {
    const tracker = new AntiStaleContextTracker()

    tracker.recordFact({
      id: "f_old",
      filePath: "src/auth.ts",
      claim: "Token expiration is 3600s",
      turnObserved: 2,
    })

    tracker.recordMutation({
      filePath: "src/auth.ts",
      turn: 4,
      mutationType: "edit",
    })

    const statusAfterMutation = tracker.checkStaleness("f_old", 5)
    expect(statusAfterMutation).toBe("invalidated")

    tracker.recordFact({
      id: "f_new",
      filePath: "src/auth.ts",
      claim: "Token expiration is 7200s",
      turnObserved: 5,
    })

    const newStatus = tracker.checkStaleness("f_new", 6)
    expect(newStatus).toBe("assumed")
  })

  test("detects age-based staleness when unverified beyond threshold", () => {
    const tracker = new AntiStaleContextTracker()

    tracker.recordFact({
      id: "f_stale_candidate",
      claim: "Database is reachable",
      turnObserved: 1,
      status: "known",
    })

    const freshStatus = tracker.checkStaleness("f_stale_candidate", 3, 5)
    expect(freshStatus).toBe("known")

    const staleStatus = tracker.checkStaleness("f_stale_candidate", 10, 5)
    expect(staleStatus).toBe("stale")

    tracker.recordFact({
      id: "f_verified",
      claim: "Service healthy",
      turnObserved: 1,
      lastVerifiedTurn: 9,
      status: "known",
    })

    const verifiedStatus = tracker.checkStaleness("f_verified", 10, 5)
    expect(verifiedStatus).toBe("known")
  })

  test("filters fresh items and isolates stale and invalidated items", () => {
    const tracker = new AntiStaleContextTracker()

    tracker.recordMutation({
      filePath: "src/config.ts",
      turn: 5,
      mutationType: "write",
    })

    const items = [
      { id: "item1", filePath: "src/config.ts", turnObserved: 3 },
      { id: "item2", filePath: "src/config.ts", turnObserved: 6 },
      { id: "item3", filePath: "src/other.ts", turnObserved: 2 },
      { id: "item4", filePath: "src/other.ts", turnObserved: 1 },
    ]

    const result = tracker.filterFreshItems(items, 8, 4)
    const freshIds = result.fresh.map((i) => i.id)
    const staleIds = result.stale.map((i) => i.id)

    expect(freshIds).toContain("item2")
    expect(staleIds).toContain("item1")
    expect(staleIds).toContain("item4")
    expect(result.invalidatedIds).toContain("item1")
  })

  test("filters facts by status and file path", () => {
    const tracker = new AntiStaleContextTracker()

    tracker.recordFact({ id: "f1", filePath: "a.ts", claim: "claim1", turnObserved: 1, status: "known" })
    tracker.recordFact({ id: "f2", filePath: "b.ts", claim: "claim2", turnObserved: 1, status: "assumed" })
    tracker.recordFact({ id: "f3", filePath: "a.ts", claim: "claim3", turnObserved: 1, status: "assumed" })

    expect(tracker.getFacts({ status: "known" }).length).toBe(1)
    expect(tracker.getFacts({ filePath: "a.ts" }).length).toBe(2)
    expect(tracker.getFacts().length).toBe(3)

    tracker.clear()
    expect(tracker.getFacts().length).toBe(0)
  })
})
