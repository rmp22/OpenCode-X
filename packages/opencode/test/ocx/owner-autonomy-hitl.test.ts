import { describe, expect, test } from "bun:test"
import { OwnerStateManager } from "@/ocx/owner/state-manager"

describe("Owner Autonomy, HITL & Long-Session Stability", () => {
  test("owner lease acquisition, conflict rejection, and expiry", async () => {
    const manager = new OwnerStateManager()
    const domain = "auth_subsystem"
    const session1 = "sess_owner_1"
    const session2 = "sess_owner_2"

    const lease1 = manager.acquireLease(domain, session1, 50)
    expect(lease1.success).toBe(true)
    expect(manager.activeLease(domain)?.sessionID).toBe(session1)

    const lease2 = manager.acquireLease(domain, session2, 50)
    expect(lease2.success).toBe(false)
    if (!lease2.success) {
      expect(lease2.reason).toContain("currently leased")
    }

    await new Promise((r) => setTimeout(r, 60))
    expect(manager.activeLease(domain)).toBeUndefined()

    const lease2AfterExpiry = manager.acquireLease(domain, session2, 50)
    expect(lease2AfterExpiry.success).toBe(true)
  })

  test("HITL protocol approval flow records approval and proposed action", () => {
    const manager = new OwnerStateManager()

    const req = manager.requestApproval({
      proposedAction: "DROP TABLE users_legacy",
      riskAssessment: "high",
      blastRadius: ["database/schema.sql", "src/models/user.ts"],
      alternativesConsidered: ["RENAME TABLE users_legacy_backup", "Mark table read-only"],
      rollbackPlan: "Restore users_legacy from snapshot_v2",
    })

    expect(req.id).toBeDefined()
    expect(req.riskAssessment).toBe("high")

    const resolution = manager.resolveApproval(req.id, true)
    expect(resolution.status).toBe("approved")
    if (resolution.status === "approved") {
      expect(resolution.action).toBe("DROP TABLE users_legacy")
    }
  })

  test("HITL protocol rejection selects alternative path instead of aborting", () => {
    const manager = new OwnerStateManager()

    const req = manager.requestApproval({
      proposedAction: "FORCE PUSH to main",
      riskAssessment: "critical",
      blastRadius: ["repo git history"],
      alternativesConsidered: ["Create merge PR branch", "Cherry-pick commit to branch"],
      rollbackPlan: "git reset --hard origin/main",
    })

    const resolution = manager.resolveApproval(req.id, false, "Do not rewrite main history")
    expect(resolution.status).toBe("rejected")
    if (resolution.status === "rejected") {
      expect(resolution.alternativePath).toBe("Create merge PR branch")
      expect(resolution.feedback).toBe("Do not rewrite main history")
    }
  })

  test("enforces domain memory bounds and evicts oldest facts", () => {
    const manager = new OwnerStateManager(3)
    const domain = "memory_domain"

    manager.recordFact(domain, "config", "k1", "val1")
    manager.recordFact(domain, "config", "k2", "val2")
    manager.recordFact(domain, "config", "k3", "val3")
    expect(manager.factsForDomain(domain).length).toBe(3)

    manager.recordFact(domain, "config", "k4", "val4")
    const facts = manager.factsForDomain(domain)
    expect(facts.length).toBe(3)
    expect(facts.some((f) => f.key === "k1")).toBe(false)
    expect(facts.some((f) => f.key === "k4")).toBe(true)
  })

  test("decays transient facts and compacts domain state for long sessions", async () => {
    const manager = new OwnerStateManager(10)
    const domain = "long_session"

    manager.recordFact(domain, "persistent", "arch_style", "clean_architecture", false)
    manager.recordFact(domain, "transient", "temp_file", "/tmp/scratch.ts", true)

    expect(manager.factsForDomain(domain).length).toBe(2)

    await new Promise((r) => setTimeout(r, 20))
    const decayed = manager.decayTransientFacts(domain, 10)
    expect(decayed).toBe(1)

    const facts = manager.factsForDomain(domain)
    expect(facts.length).toBe(1)
    expect(facts[0].key).toBe("arch_style")

    const compaction = manager.compactDomainState(domain)
    expect(compaction.retainedFactsCount).toBe(1)
  })
})
