import { describe, expect, it } from "bun:test"
import { PathLeaseManager, pathsOverlap } from "../../src/ocx/owner/lease-manager"

describe("PathLeaseManager and Fine-Grained Concurrency", () => {
  it("computes path prefix overlap correctly", () => {
    expect(pathsOverlap("packages/core", "packages/core/src/index.ts")).toBe(true)
    expect(pathsOverlap("packages/core/src/index.ts", "packages/core")).toBe(true)
    expect(pathsOverlap("packages/core", "packages/ui")).toBe(false)
    expect(pathsOverlap("packages/core/src/a.ts", "packages/core/src/b.ts")).toBe(false)
  })

  it("allows concurrent leases on non-overlapping paths", () => {
    const mgr = new PathLeaseManager()
    const l1 = mgr.acquirePathLease("packages/core", "core", "session-1")
    const l2 = mgr.acquirePathLease("packages/ui", "ui", "session-2")

    expect(l1.success).toBe(true)
    expect(l2.success).toBe(true)
    expect(mgr.listActiveLeases().length).toBe(2)
  })

  it("prevents conflicting lease on overlapping path by another session", () => {
    const mgr = new PathLeaseManager()
    const l1 = mgr.acquirePathLease("packages/core", "core", "session-1")
    expect(l1.success).toBe(true)

    const conflict = mgr.acquirePathLease("packages/core/src/session.ts", "session-worker", "session-2")
    expect(conflict.success).toBe(false)
    if (!conflict.success) {
      expect(conflict.reason).toContain("Conflict with active lease")
    }
  })

  it("allows same session to acquire subpaths or renew", () => {
    const mgr = new PathLeaseManager()
    const l1 = mgr.acquirePathLease("packages/core", "core", "session-1")
    expect(l1.success).toBe(true)

    const sameSession = mgr.acquirePathLease("packages/core/src/session.ts", "core", "session-1")
    expect(sameSession.success).toBe(true)
  })

  it("releases individual lease and releases all for session", () => {
    const mgr = new PathLeaseManager()
    const l1 = mgr.acquirePathLease("packages/core", "core", "session-1")
    const l2 = mgr.acquirePathLease("packages/tui", "tui", "session-1")
    const l3 = mgr.acquirePathLease("packages/ui", "ui", "session-2")
    expect(l2.success && l3.success).toBe(true)

    expect(l1.success && mgr.releasePathLease(l1.lease.leaseId)).toBe(true)
    expect(mgr.listActiveLeases().length).toBe(2)

    const released = mgr.releaseAllForSession("session-1")
    expect(released).toBe(1)
    expect(mgr.listActiveLeases().length).toBe(1)
    expect(mgr.listActiveLeases()[0].sessionID).toBe("session-2")
  })

  it("acquires atomic node leases and rolls back on partial conflict", () => {
    const mgr = new PathLeaseManager()
    mgr.acquirePathLease("packages/core/src/index.ts", "core", "session-1")

    const nodeAcq = mgr.acquireNodeLeases(
      "node-1",
      "ui",
      ["packages/ui/src/button.tsx", "packages/core/src/index.ts"],
      "session-2"
    )

    expect(nodeAcq.acquired).toBe(false)
    expect(nodeAcq.conflictPath).toBe("packages/core/src/index.ts")
    expect(mgr.isPathLeased("packages/ui/src/button.tsx")).toBe(false)
  })
})
