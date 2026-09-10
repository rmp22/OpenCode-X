import { describe, expect, test } from "bun:test"
import { ClaimLifecycleManager } from "@/ocx/claims"

describe("Structured Claim Lifecycle", () => {
  test("asserts a claim with citations", () => {
    const mgr = new ClaimLifecycleManager()
    const claim = mgr.assert({
      nodeId: "exec_1",
      stepId: "step_auth",
      assertion: "Password hashing uses argon2id",
      citations: [{ filePath: "src/auth/hash.ts", lineNumber: 42 }],
    })

    expect(claim.status).toBe("asserted")
    expect(claim.assertion).toBe("Password hashing uses argon2id")
    expect(claim.citations.length).toBe(1)

    const formatted = mgr.formatClaimOutput(claim)
    expect(formatted).toBe("UNVERIFIED: Password hashing uses argon2id (src/auth/hash.ts:42)")
  })

  test("cannot verify claim without valid evidence registered in pool", () => {
    const mgr = new ClaimLifecycleManager()
    const claim = mgr.assert({
      nodeId: "verify_1",
      assertion: "All unit tests pass",
    })

    const noEvidence = mgr.verify(claim.id, [])
    expect(noEvidence.success).toBe(false)
    if (!noEvidence.success) {
      expect(noEvidence.reason).toContain("at least one supporting evidence ID")
    }

    const unregisteredEvidence = mgr.verify(claim.id, ["ev_fake_123"])
    expect(unregisteredEvidence.success).toBe(false)
    if (!unregisteredEvidence.success) {
      expect(unregisteredEvidence.reason).toContain("not registered in evidence pool")
    }

    mgr.registerEvidence("ev_test_run_42")
    const verified = mgr.verify(claim.id, ["ev_test_run_42"])
    expect(verified.success).toBe(true)
    if (verified.success) {
      expect(verified.claim.status).toBe("verified")
      expect(verified.claim.evidenceIds).toEqual(["ev_test_run_42"])
      const formatted = mgr.formatClaimOutput(verified.claim)
      expect(formatted).toBe("VERIFIED: All unit tests pass")
    }
  })

  test("refutes a claim with reason", () => {
    const mgr = new ClaimLifecycleManager()
    const claim = mgr.assert({
      nodeId: "exec_1",
      assertion: "Memory usage is below 50MB",
    })

    const refuted = mgr.refute(claim.id, "Profile showed 120MB heap usage")
    expect(refuted.status).toBe("refuted")
    expect(refuted.refutationReason).toBe("Profile showed 120MB heap usage")
  })

  test("unverified claims block terminal completion", () => {
    const mgr = new ClaimLifecycleManager()
    const claim1 = mgr.assert({
      nodeId: "node_final",
      assertion: "Security audit clean",
    })

    expect(mgr.canComplete("node_final").allowed).toBe(false)
    expect(mgr.canComplete("node_final").unverified.length).toBe(1)

    mgr.registerEvidence("ev_sec_audit")
    mgr.verify(claim1.id, ["ev_sec_audit"])

    expect(mgr.canComplete("node_final").allowed).toBe(true)
    expect(mgr.canComplete("node_final").unverified.length).toBe(0)
  })
})
