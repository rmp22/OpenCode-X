import { describe, expect, it } from "bun:test"
import {
  HierarchicalBudgetTracker,
  ProgressCycleBreaker,
  ResearchGovernor,
  ToolHealthTracker,
} from "../../src/ocx/owner/governance"
import { PathLeaseManager, pathsOverlap } from "../../src/ocx/owner/lease-manager"
import {
  ObservationCache,
  PeerAgentRuntime,
  ScopeMemoryStore,
} from "../../src/ocx/owner/peer-runtime"
import { OwnershipResolver } from "../../src/ocx/owner/resolver"
import {
  createWorkspaceIdentity,
  parseAospOwners,
  parseCodeowners,
  toWorkdirRelative,
  VirtualOwnerTreeManager,
} from "../../src/ocx/owner/workspace-tree"

describe("Production Gate Evaluation: Workdir Owner Architecture", () => {
  const root = "/workspace/test-repo"
  const workspace = createWorkspaceIdentity(root)

  it("1. Delineates workdir-relative scopes and prevents absolute path domains", () => {
    expect(toWorkdirRelative(root, "/workspace/test-repo/src/index.ts")).toBe("src/index.ts")
    expect(toWorkdirRelative(root, "/home/user/other/file.ts")).toBe("file.ts")

    const resolver = OwnershipResolver.forWorkdir(process.cwd())
    const res = resolver.resolve({
      paths: [`${process.cwd()}/src/tool/task.ts`],
    })
    expect(res.owner.id).not.toBe("mnt")
    expect(res.owner.id).not.toBe("home")
    expect(res.owner.id).not.toBe("workspace")
  })

  it("2. Parses optional AOSP OWNERS and CODEOWNERS without creating fake agent personas", () => {
    const aosp = `alice@domain.com
bob@domain.com
set noparent
per-file *.bp = carl@domain.com`
    const parsedAosp = parseAospOwners(aosp, "core")
    expect(parsedAosp.noParent).toBe(true)
    expect(parsedAosp.directOwners).toEqual(["alice@domain.com", "bob@domain.com"])
    expect(parsedAosp.perFileDirectives[0].pattern).toBe("*.bp")

    const codeowners = `/src/ @core-team
docs/ @writers`
    const parsedCodeowners = parseCodeowners(codeowners)
    expect(parsedCodeowners.length).toBe(2)
  })

  it("3. Builds Virtual OwnerTree in OCX state without writing files in user repo", () => {
    const mgr = new VirtualOwnerTreeManager()
    const tree = mgr.discoverTree(workspace)
    expect(tree.rootNodeId).toBe("root")
    expect(tree.workspace.repoId).toBe(workspace.repoId)

    const owners = mgr.convertToConcreteOwners(tree)
    expect(owners.length).toBeGreaterThan(0)
    expect(owners.every((o) => o.scopes.length > 0)).toBe(true)
  })

  it("4. Treats UI/Security/Networking as review concerns without routing authority", () => {
    const resolver = OwnershipResolver.forWorkdir(process.cwd())
    const res = resolver.resolve({
      paths: ["packages/core/src/index.ts"],
      prompt: "Security review for networking tokens and UI polish",
    })
    expect(res.reviewConcerns).toContain("security")
    expect(res.reviewConcerns).toContain("networking")
    expect(res.reviewConcerns).toContain("ui")
    expect(res.owner.kind).not.toBe("custom")
  })

  it("5. Executes peer agent tasks with warm-start familiarity and observation reuse", () => {
    const memory = new ScopeMemoryStore()
    memory.addFact({
      id: "fact-1",
      ownerId: "core",
      category: "architecture",
      key: "StorageEngine",
      value: "SQLite",
      sourcePath: "packages/core/src/storage.ts",
      updatedAt: Date.now(),
    })

    const fam = memory.getFamiliarity("core")
    expect(fam.facts.length).toBe(1)
    expect(memory.renderFamiliarityContext(fam)).toContain("StorageEngine: SQLite")

    const inv = memory.invalidateChangedFiles("core", ["packages/core/src/storage.ts"])
    expect(inv.invalidated).toBe(1)
    expect(inv.retained).toBe(0)

    const obs = new ObservationCache()
    obs.set({
      path: "packages/core/src/types.ts",
      contentHash: "hash-99",
      mtimeMs: 100,
      observedAt: Date.now(),
      observedBy: "core",
    })
    expect(obs.hasRecent("packages/core/src/types.ts")).toBe(true)
    expect(obs.get("packages/core/src/types.ts", 100)?.contentHash).toBe("hash-99")
  })

  it("6. Manages non-overlapping concurrent path leases and detects conflicts", () => {
    const leaseMgr = new PathLeaseManager()
    expect(pathsOverlap("packages/core", "packages/core/src/auth.ts")).toBe(true)
    expect(pathsOverlap("packages/core", "packages/ui")).toBe(false)

    const l1 = leaseMgr.acquirePathLease("packages/core", "core", "sess-1")
    const l2 = leaseMgr.acquirePathLease("packages/ui", "ui", "sess-2")
    expect(l1.success && l2.success).toBe(true)

    const conflict = leaseMgr.acquirePathLease("packages/core/src/auth.ts", "core", "sess-3")
    expect(conflict.success).toBe(false)
  })

  it("7. Prevents runaway loops via cycle breaker, tool health, and hierarchical budgets", () => {
    const breaker = new ProgressCycleBreaker(2)
    breaker.recordStep("read", { path: "foo.ts" })
    const v = breaker.recordStep("read", { path: "foo.ts" })
    expect(v.shouldBreak).toBe(true)

    const health = new ToolHealthTracker(2)
    health.recordFailure("webfetch")
    const f2 = health.recordFailure("webfetch")
    expect(f2.isUnhealthy).toBe(true)
    expect(health.isHealthy("webfetch")).toBe(false)

    const gov = new ResearchGovernor(1)
    expect(gov.recordResearchCall().allowed).toBe(true)
    expect(gov.recordResearchCall().allowed).toBe(false)

    const budget = HierarchicalBudgetTracker.createDefault(2, 5000, 5, 5000)
    expect(budget.recordTurn(1000).mustCheckpoint).toBe(true)
    expect(budget.recordTurn(4000).exhausted).toBe(true)
  })

  it("8. Emits structured convergence results and typed handoffs", () => {
    const runtime = new PeerAgentRuntime()
    const handoff = runtime.createHandoff({
      fromOwnerId: "core",
      toOwnerId: "ui",
      taskId: "task-final",
      reason: "UI integration",
      sharedScope: ["packages/ui/src/button.tsx"],
      suggestedAction: "Bind button to core event",
    })

    const result = runtime.createExecutionResult({
      taskId: "task-final",
      ownerId: "core",
      status: "completed",
      summary: "Core event emitter finalized",
      touchedFiles: ["packages/core/src/event.ts"],
      consumedBudget: {
        turns: 2,
        tokens: 3500,
        toolCalls: 3,
        elapsedMs: 1200,
      },
      handoff,
    })

    expect(result.status).toBe("completed")
    expect(result.summary).toBe("Core event emitter finalized")
    expect(result.handoff?.toOwnerId).toBe("ui")
    expect(result.consumedBudget.turns).toBe(2)
  })
})
