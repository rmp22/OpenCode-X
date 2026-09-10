import { describe, expect, test } from "bun:test"
import { TrajectoryEmitter, redactSecrets } from "@/ocx/observability/emitter"

describe("Trajectory & Observability", () => {
  test("redacts bearer tokens and secret credentials", () => {
    const text = "Found key: api_key = 'sk-1234567890abcdef' and Bearer xyz987654"
    const redacted = redactSecrets(text)
    expect(redacted).not.toContain("sk-1234567890abcdef")
    expect(redacted).not.toContain("xyz987654")
    expect(redacted).toContain("[REDACTED_SECRET]")
  })

  test("records trajectory events and calculates session metrics", () => {
    const emitter = new TrajectoryEmitter("session-obs-1")

    emitter.emit("turn_start", { turnIndex: 1 })
    emitter.emit("tool_call", { tool: "read", params: { filePath: "a.ts" } })
    emitter.emit("tool_result", { tool: "read", status: "success" })
    emitter.emit("mutation_applied", { filePath: "a.ts", linesAdded: 5 })
    emitter.emit("claim_evaluated", { claimId: "c1", state: "verified" })
    emitter.emit("turn_end", { turnIndex: 1 })

    const events = emitter.getEvents()
    expect(events.length).toBe(6)

    const metrics = emitter.computeMetrics()
    expect(metrics.totalTurns).toBe(1)
    expect(metrics.toolInvocations).toBe(1)
    expect(metrics.failedToolCalls).toBe(0)
    expect(metrics.mutationsApplied).toBe(1)
    expect(metrics.claimsVerified).toBe(1)
  })
})
