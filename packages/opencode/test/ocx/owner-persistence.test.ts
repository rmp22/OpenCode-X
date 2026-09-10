import { describe, expect, test } from "bun:test"
import { OwnerStateManager } from "@/ocx/owner/state-manager"

describe("Owner Persistence & Domain Lease Management", () => {
  test("acquires and releases domain leases", () => {
    const mgr = new OwnerStateManager()
    const session1 = "sess_1"

    const res1 = mgr.acquireLease("auth", session1)
    expect(res1.success).toBe(true)
    expect(mgr.activeLease("auth")?.sessionID).toBe(session1)

    const released = mgr.releaseLease("auth", session1)
    expect(released).toBe(true)
    expect(mgr.activeLease("auth")).toBeUndefined()
  })

  test("prevents conflicting concurrent lease requests", () => {
    const mgr = new OwnerStateManager()
    const session1 = "sess_1"
    const session2 = "sess_2"

    const res1 = mgr.acquireLease("database", session1, 10000)
    expect(res1.success).toBe(true)

    const res2 = mgr.acquireLease("database", session2)
    expect(res2.success).toBe(false)
    if (!res2.success) {
      expect(res2.reason).toContain("currently leased to session")
    }

    const extend = mgr.acquireLease("database", session1)
    expect(extend.success).toBe(true)
  })

  test("persists domain facts and memory across sessions", () => {
    const mgr = new OwnerStateManager()

    mgr.recordFact("auth", "convention", "token_format", "Bearer JWT")
    mgr.recordFact("auth", "security", "hash_algorithm", "argon2id")

    const facts = mgr.factsForDomain("auth")
    expect(facts.length).toBe(2)
    expect(facts.some((f) => f.key === "token_format" && f.value === "Bearer JWT")).toBe(true)
    expect(facts.some((f) => f.key === "hash_algorithm" && f.value === "argon2id")).toBe(true)

    mgr.recordFact("auth", "convention", "token_format", "Paseto v4")
    const updatedFacts = mgr.factsForDomain("auth")
    expect(updatedFacts.length).toBe(2)
    expect(updatedFacts.find((f) => f.key === "token_format")?.value).toBe("Paseto v4")
  })
})
