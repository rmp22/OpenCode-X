import { describe, expect, test } from "bun:test"
import { EventJournal, GraphRecoveryEngine } from "@/ocx/events"

describe("Event Journal & Graph Recovery Engine", () => {
  test("appends and reads events from journal", () => {
    const journal = new EventJournal("sess_rec_1")
    journal.append({
      type: "node_entered",
      nodeId: "plan",
      timestamp: 1000,
    })
    journal.append({
      type: "node_entered",
      nodeId: "execute",
      timestamp: 2000,
    })

    const events = journal.readAll()
    expect(events.length).toBe(2)
    expect(events[0].type).toBe("node_entered")
    if (events[1].type === "node_entered") {
      expect(events[1].nodeId).toBe("execute")
    }
  })

  test("recovery from mid-execution journal resumes at exact node", () => {
    const events = [
      { type: "node_entered" as const, nodeId: "plan", timestamp: 100 },
      { type: "node_entered" as const, nodeId: "execute", timestamp: 200 },
      {
        type: "evidence_collected" as const,
        evidenceId: "ev_1",
        kind: "diff_inspection",
        detail: "changed file",
        timestamp: 250,
      },
      { type: "node_entered" as const, nodeId: "verify", timestamp: 300 },
    ]

    const state = GraphRecoveryEngine.replay(events, "plan")
    expect(state.currentNode).toBe("verify")
    expect(state.visitedNodes).toContain("execute")
    expect(state.visitedNodes).toContain("verify")
    expect(state.accumulatedEvidence.length).toBe(1)
    expect(state.isSuspended).toBe(false)
  })

  test("recovery from suspended state preserves suspension and reason", () => {
    const events = [
      { type: "node_entered" as const, nodeId: "plan", timestamp: 100 },
      { type: "node_entered" as const, nodeId: "execute", timestamp: 200 },
      {
        type: "suspended" as const,
        kind: "user_input",
        reason: "Need user decision on database type",
        timestamp: 250,
      },
    ]

    const state = GraphRecoveryEngine.replay(events, "plan")
    expect(state.currentNode).toBe("execute")
    expect(state.isSuspended).toBe(true)
    expect(state.activeSuspensionReason).toBe("Need user decision on database type")

    const withResume = [
      ...events,
      { type: "resumed" as const, suspensionId: "susp_123", timestamp: 300 },
    ]
    const resumedState = GraphRecoveryEngine.replay(withResume, "plan")
    expect(resumedState.isSuspended).toBe(false)
    expect(resumedState.activeSuspensionReason).toBeUndefined()
  })

  test("tracks claim verification in recovered state", () => {
    const events = [
      { type: "node_entered" as const, nodeId: "plan", timestamp: 100 },
      {
        type: "claim_asserted" as const,
        claimId: "c1",
        assertion: "Tests pass",
        nodeId: "plan",
        timestamp: 150,
      },
      {
        type: "claim_verified" as const,
        claimId: "c1",
        evidenceIds: ["ev_test_1"],
        timestamp: 200,
      },
    ]

    const state = GraphRecoveryEngine.replay(events, "plan")
    expect(state.verifiedClaims).toContain("c1")
  })
})
