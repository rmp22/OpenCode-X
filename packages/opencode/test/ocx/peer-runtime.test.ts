import { describe, expect, it } from "bun:test"
import {
  ObservationCache,
  PeerAgentRuntime,
  ScopeMemoryStore,
} from "../../src/ocx/owner/peer-runtime"

describe("PeerAgentRuntime and Scope Memory", () => {
  it("stores scope facts and delivers warm-start familiarity", () => {
    const memory = new ScopeMemoryStore()
    memory.addFact({
      id: "fact-1",
      ownerId: "core",
      category: "architecture",
      key: "SessionStore",
      value: "SQLite backed session persistence in core",
      sourcePath: "packages/core/src/session.ts",
      updatedAt: Date.now(),
    })
    memory.addFact({
      id: "fact-2",
      ownerId: "core",
      category: "interface",
      key: "createSession",
      value: "(opts: SessionOpts) => Promise<Session>",
      sourcePath: "packages/core/src/session.ts",
      updatedAt: Date.now(),
    })

    const fam = memory.getFamiliarity("core")
    expect(fam.ownerId).toBe("core")
    expect(fam.facts.length).toBe(2)
    expect(fam.keyInterfaces).toContain("createSession: (opts: SessionOpts) => Promise<Session>")
    expect(fam.tokenSavingsEstimate).toBeGreaterThan(0)

    const rendered = memory.renderFamiliarityContext(fam)
    expect(rendered).toContain("SCOPE FAMILIARITY WARM-START (core)")
    expect(rendered).toContain("SessionStore: SQLite backed session persistence in core")
  })

  it("incrementally invalidates only facts for changed files", () => {
    const memory = new ScopeMemoryStore()
    memory.addFact({
      id: "f1",
      ownerId: "ui",
      category: "interface",
      key: "Button",
      value: "Component props",
      sourcePath: "packages/ui/src/button.tsx",
      updatedAt: Date.now(),
    })
    memory.addFact({
      id: "f2",
      ownerId: "ui",
      category: "interface",
      key: "Dialog",
      value: "Modal props",
      sourcePath: "packages/ui/src/dialog.tsx",
      updatedAt: Date.now(),
    })

    const invResult = memory.invalidateChangedFiles("ui", ["packages/ui/src/button.tsx"])
    expect(invResult.invalidated).toBe(1)
    expect(invResult.retained).toBe(1)

    const remaining = memory.getFactsForOwner("ui")
    expect(remaining.length).toBe(1)
    expect(remaining[0].key).toBe("Dialog")
  })

  it("caches and reuses source observations", () => {
    const obsCache = new ObservationCache()
    obsCache.set({
      path: "packages/core/src/index.ts",
      contentHash: "hash-abc-123",
      mtimeMs: 1000,
      snippet: "export * from './session'",
      observedAt: Date.now(),
      observedBy: "core",
    })

    expect(obsCache.hasRecent("packages/core/src/index.ts")).toBe(true)
    const cached = obsCache.get("packages/core/src/index.ts", 1000)
    expect(cached).toBeDefined()
    expect(cached?.contentHash).toBe("hash-abc-123")

    const expired = obsCache.get("packages/core/src/index.ts", 2000)
    expect(expired).toBeUndefined()
  })

  it("prepares execution packets and typed results with checkpoints", () => {
    const runtime = new PeerAgentRuntime()
    const packet = runtime.prepareExecutionPacket({
      taskId: "task-100",
      ownerId: "core",
      goal: "Refactor session store",
      scopePaths: ["packages/core/src/session.ts"],
      budget: {
        maxTurns: 10,
        maxTokens: 50_000,
      },
    })
    expect(packet.taskId).toBe("task-100")
    expect(packet.ownerId).toBe("core")

    runtime.recordCheckpoint({
      checkpointId: "chk-1",
      taskId: "task-100",
      ownerId: "core",
      step: 1,
      state: "in_progress",
      summary: "Updated schema definition",
      evidence: ["schema.ts modified"],
      completed: false,
      touchedFiles: ["packages/core/src/schema.ts"],
      timestamp: Date.now(),
    })

    const handoff = runtime.createHandoff({
      fromOwnerId: "core",
      toOwnerId: "ui",
      taskId: "task-100",
      reason: "Session state UI bindings",
      sharedScope: ["packages/ui/src/session-view.tsx"],
      suggestedAction: "Update component props to new session type",
    })

    const result = runtime.createExecutionResult({
      taskId: "task-100",
      ownerId: "core",
      status: "completed",
      summary: "Completed schema and core session update",
      touchedFiles: ["packages/core/src/session.ts", "packages/core/src/schema.ts"],
      producedArtifacts: ["packages/core/src/schema.ts"],
      consumedBudget: {
        turns: 4,
        tokens: 12_000,
        toolCalls: 5,
        elapsedMs: 3500,
      },
      handoff,
    })

    expect(result.status).toBe("completed")
    expect(result.checkpoint?.checkpointId).toBe("chk-1")
    expect(result.handoff?.toOwnerId).toBe("ui")
    expect(result.touchedFiles).toContain("packages/core/src/session.ts")
  })
})
