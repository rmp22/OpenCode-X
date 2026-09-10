import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ContextCommandService } from "../../src/ocx/context/commands"
import { ContextExploration } from "../../src/ocx/context/exploration"
import { ContextFreshnessTracker } from "../../src/ocx/context/freshness"
import { ContextOrchestration } from "../../src/ocx/context/orchestration"
import { ContextRenderer } from "../../src/ocx/context/renderer"
import { ContextRetriever } from "../../src/ocx/context/retriever"
import { ContextService } from "../../src/ocx/context/service"
import { ContextStore } from "../../src/ocx/context/store"
import { ContextTransactionManager } from "../../src/ocx/context/transaction"
import { CodebaseMap } from "../../src/ocx/codebase/map"
import { CodebaseProfile } from "../../src/ocx/codebase/profile"
import {
  CONTEXT_SCHEMA_VERSION,
  edgeID,
  nodeID,
  pipelineID,
  repositoryID,
  type ContextNode,
  type Finding,
  type RepositoryContext,
} from "../../src/ocx/context/types"

function openFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ocx-context-system-"))
  const store = ContextStore.memory()
  return { root, store, handle: ContextService.open({ root, store }) }
}

function finding(input: {
  readonly subject: string
  readonly object: string
  readonly file: string
  readonly symbol: string
  readonly hash?: string
  readonly scope?: string
}): Finding {
  return {
    subject: input.subject,
    relation: "calls",
    object: input.object,
    confidence: "VERIFIED",
    evidence: [
      {
        file: input.file,
        symbol: input.symbol,
        contentHash: input.hash ?? "fixture-hash",
        observation: `${input.subject} calls ${input.object}.`,
      },
    ],
    scope: input.scope ?? "request flow",
  }
}

function node(input: {
  readonly id: string
  readonly name: string
  readonly evidenceIDs?: readonly string[]
}): ContextNode {
  return {
    id: nodeID(input.id),
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    kind: "component",
    canonicalName: input.name,
    repositoryID: repositoryID(`repo-${"d".repeat(32)}`),
    metadata: {},
    confidence: "VERIFIED",
    status: "active",
    evidenceIDs: (input.evidenceIDs ?? []) as ContextNode["evidenceIDs"],
    aliases: [],
  }
}

describe("context exploration and integration", () => {
  test("uses mapper structure for a scoped explicit exploration", () => {
    const fixture = openFixture()
    try {
      const paths = ["package.json", "src/package.json", "src/service.ts", "vendor/generated.ts"]
      const profile = CodebaseProfile.profileFromPaths({
        root: fixture.root,
        paths,
        rootEntries: ["package.json", "src", "vendor"],
      })
      const map = CodebaseMap.discoverMap({
        root: fixture.root,
        paths,
        buildFiles: {
          "package.json": '{"name":"fixture"}',
          "src/package.json": '{"name":"service"}',
        },
        buildSystems: profile.buildSystems,
      })
      const result = ContextCommandService.execute({
        root: fixture.root,
        command: "/explore_codebase src",
        store: fixture.store,
        mapper: { profile, map, revision: "revision-1" },
      })
      const stored = fixture.store.load(fixture.handle.repositoryID)

      expect(result.changed).toBe(true)
      expect(result.text).toContain("Resolved scope: module src")
      expect(stored?.nodes.some((node) => node.canonicalName === "module:src")).toBe(true)
      expect(stored?.pipelines[0]?.confidence).toBe("INFERRED")
      expect(stored?.nodes.some((node) => node.canonicalName === "module:vendor")).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("plans hierarchical work instead of a root recursive search for massive repositories", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-large-"))
    try {
      const profile = CodebaseProfile.profileFromPaths({
        root,
        paths: ["src/service.ts", "src/worker.ts"],
        truncated: true,
        estimatedFileCount: 300_000,
      })
      const map = CodebaseMap.discoverMap({ root, paths: ["src/service.ts", "src/worker.ts"] })
      const scope = ContextExploration.resolveScope({ root, userScope: "full", profile, map })
      const plan = ContextExploration.plan({ root, scope, profile, map })

      expect(scope.depth).toBe("L5")
      expect(plan.units.length).toBeGreaterThan(0)
      expect(plan.units.every((unit) => unit.broadSearch === false)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("extracts only bounded relative import flows from selected source samples", () => {
    const findings = ContextExploration.sourceFindings({
      scope: "src",
      sources: [
        { file: "src/a.ts", content: 'import { b } from "./b"\nexport const a = b' },
        { file: "src/b.ts", content: "export const b = true" },
        { file: "src/unrelated.ts", content: 'import x from "external-package"' },
      ],
      revision: "revision-1",
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      subject: "file:src/a.ts",
      relation: "depends_on",
      object: "file:src/b.ts",
      confidence: "VERIFIED",
    })
    expect(findings[0]?.evidence[0]?.contentHash).toHaveLength(64)
  })

  test("builds a source-backed pipeline proposal and applies it transactionally", () => {
    const fixture = openFixture()
    try {
      const built = ContextExploration.build({
        repositoryID: fixture.handle.repositoryID,
        existing: fixture.handle.context,
        findings: [finding({ subject: "CLI", object: "Service", file: "src/cli.ts", symbol: "CLI.run" })],
        taskID: "explore-task",
        sourceRevision: "revision-1",
        reason: "map request flow",
      })
      expect(built.transaction).toBeDefined()
      const applied = ContextService.apply(fixture.handle, built.transaction!)

      expect(applied.context.pipelines).toHaveLength(1)
      expect(applied.context.components).toHaveLength(1)
      expect(applied.context.edges).toHaveLength(1)
      expect(applied.context.evidence).toHaveLength(1)
      expect(applied.context.nodes.find((item) => item.canonicalName === "CLI")?.metadata.files).toEqual(["src/cli.ts"])
      expect(fixture.store.history(fixture.handle.repositoryID)).toHaveLength(1)
      expect(fixture.store.indexes(fixture.handle.repositoryID)).toBeDefined()
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("rejects an evidence-free VERIFIED update", () => {
    const fixture = openFixture()
    try {
      const invalid = ContextTransactionManager.create({
        repositoryID: fixture.handle.repositoryID,
        origin: { taskID: "invalid-task" },
        reason: "invalid verified claim",
        operations: [
          {
            op: "upsert_node",
            node: {
              ...node({ id: "node-invalid", name: "Invalid" }),
              repositoryID: fixture.handle.repositoryID,
            },
          },
        ],
      })
      expect(ContextTransactionManager.validate(invalid, fixture.handle.context)).toEqual({
        valid: false,
        errors: ["node node-invalid VERIFIED claim has no evidence"],
      })
      expect(() => ContextTransactionManager.apply(fixture.handle.context, invalid)).toThrow()
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("preserves stronger current evidence over a weaker update", () => {
    const fixture = openFixture()
    try {
      const first = ContextExploration.build({
        repositoryID: fixture.handle.repositoryID,
        existing: fixture.handle.context,
        findings: [
          finding({ subject: "Service", object: "Repository", file: "src/service.ts", symbol: "Service.run" }),
        ],
        taskID: "first",
        reason: "first source trace",
      })
      const applied = ContextService.apply(fixture.handle, first.transaction!)
      const current = applied.context.nodes.find((item) => item.canonicalName === "Service")!
      const weaker = ContextTransactionManager.create({
        repositoryID: fixture.handle.repositoryID,
        origin: { taskID: "weaker" },
        reason: "weaker repeat",
        operations: [{ op: "upsert_node", node: { ...current, confidence: "SUPPORTED", evidenceIDs: [] } }],
      })
      const result = ContextTransactionManager.apply(applied.context, weaker)
      expect(result.context.nodes.find((item) => item.id === current.id)?.confidence).toBe("VERIFIED")
      expect(result.context.nodes.find((item) => item.id === current.id)?.evidenceIDs).toEqual(current.evidenceIDs)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("makes incompatible strong owner updates visible as CONFLICTED", () => {
    const fixture = openFixture()
    try {
      const first = ContextExploration.build({
        repositoryID: fixture.handle.repositoryID,
        existing: fixture.handle.context,
        findings: [
          finding({
            subject: "Controller",
            object: "Worker",
            file: "src/controller.ts",
            symbol: "Controller.run",
            scope: "jobs",
          }),
        ],
        taskID: "owner-a",
        reason: "owner A trace",
      })
      const applied = ContextService.apply(fixture.handle, first.transaction!)
      const second = ContextExploration.build({
        repositoryID: fixture.handle.repositoryID,
        existing: applied.context,
        findings: [
          finding({
            subject: "Controller",
            object: "Queue",
            file: "src/controller.ts",
            symbol: "Controller.dispatch",
            scope: "jobs",
          }),
        ],
        taskID: "owner-b",
        reason: "owner B trace",
      })
      const result = ContextTransactionManager.apply(applied.context, second.transaction!)

      expect(result.status).toBe("CONFLICTED")
      expect(result.conflicts).toHaveLength(1)
      expect(result.context.edges.every((edge) => edge.status === "conflicted")).toBe(true)
      expect(result.context.edges.every((edge) => edge.confidence === "CONFLICTED")).toBe(true)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("merges compatible updates from handles opened at the same time", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-concurrent-"))
    try {
      const store = ContextStore.memory()
      const first = ContextService.open({ root, store })
      const second = ContextService.open({ root, store })
      const firstProposal = ContextExploration.build({
        repositoryID: first.repositoryID,
        existing: first.context,
        findings: [
          finding({
            subject: "First",
            object: "Worker",
            file: "src/first.ts",
            symbol: "First.run",
            scope: "first flow",
          }),
        ],
        taskID: "concurrent-first",
        reason: "first concurrent update",
      })
      const secondProposal = ContextExploration.build({
        repositoryID: second.repositoryID,
        existing: second.context,
        findings: [
          finding({
            subject: "Second",
            object: "Worker",
            file: "src/second.ts",
            symbol: "Second.run",
            scope: "second flow",
          }),
        ],
        taskID: "concurrent-second",
        reason: "second concurrent update",
      })
      ContextService.apply(first, firstProposal.transaction!)
      const merged = ContextService.apply(second, secondProposal.transaction!)

      expect(merged.context.pipelines.map((pipeline) => pipeline.name)).toEqual(["first-flow", "second-flow"])
      expect(store.load(first.repositoryID)?.edges).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("marks only evidence-dependent context stale and recovers a moved file", () => {
    const fixture = openFixture()
    try {
      const source = "export function run() { return 1 }"
      const hash = ContextFreshnessTracker.fingerprint(source)
      const built = ContextExploration.build({
        repositoryID: fixture.handle.repositoryID,
        existing: fixture.handle.context,
        findings: [
          finding({ subject: "Service", object: "Worker", file: "src/service.ts", symbol: "Service.run", hash }),
        ],
        taskID: "freshness",
        reason: "freshness fixture",
      })
      const applied = ContextService.apply(fixture.handle, built.transaction!)
      const unchanged = ContextFreshnessTracker.check(
        applied.context,
        ContextFreshnessTracker.snapshot({
          repositoryID: fixture.handle.repositoryID,
          revision: "next",
          files: { "src/service.ts": source, "src/unrelated.ts": "changed" },
        }),
      )
      expect(unchanged.changedEvidenceIDs).toEqual([])
      expect(unchanged.affectedEntryIDs).toEqual([])

      const moved = ContextFreshnessTracker.check(
        applied.context,
        ContextFreshnessTracker.snapshot({
          repositoryID: fixture.handle.repositoryID,
          revision: "next",
          files: { "src/moved.ts": source },
        }),
      )
      expect(moved.movedEvidenceIDs).toHaveLength(1)
      expect(moved.changedEvidenceIDs).toEqual([])
      const recovered = ContextFreshnessTracker.refresh(
        applied.context,
        ContextFreshnessTracker.snapshot({
          repositoryID: fixture.handle.repositoryID,
          revision: "next",
          files: { "src/moved.ts": source },
        }),
      )
      expect(recovered.context.evidence[0]?.file).toBe("src/moved.ts")
      expect(recovered.context.edges[0]?.status).toBe("active")

      const changed = ContextFreshnessTracker.check(
        applied.context,
        ContextFreshnessTracker.snapshot({
          repositoryID: fixture.handle.repositoryID,
          revision: "next",
          files: { "src/service.ts": "changed" },
        }),
      )
      expect(changed.changedEvidenceIDs).toHaveLength(1)
      expect(changed.affectedEntryIDs.length).toBeGreaterThan(0)
      expect(ContextFreshnessTracker.markStale(applied.context, changed).pipelines[0]?.status).toBe("stale")
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("retrieves the direct symbol pipeline and respects a packet budget", () => {
    const fixture = openFixture()
    try {
      const first = ContextExploration.build({
        repositoryID: fixture.handle.repositoryID,
        existing: fixture.handle.context,
        findings: [
          finding({
            subject: "Target",
            object: "Worker",
            file: "src/target.ts",
            symbol: "Target.run",
            scope: "target flow",
          }),
        ],
        taskID: "target",
        reason: "target flow",
      })
      const applied = ContextService.apply(fixture.handle, first.transaction!)
      const second = ContextExploration.build({
        repositoryID: fixture.handle.repositoryID,
        existing: applied.context,
        findings: [
          finding({
            subject: "Other",
            object: "Unrelated",
            file: "src/other.ts",
            symbol: "Other.run",
            scope: "other flow",
          }),
        ],
        taskID: "other",
        reason: "other flow",
      })
      const complete = ContextService.apply(applied.handle, second.transaction!)
      const result = ContextRetriever.retrieve({
        context: complete.context,
        query: { repositoryID: fixture.handle.repositoryID, symbols: ["Target.run"] },
        budget: { maxChars: 2_000, maxPipelines: 2, maxNodes: 4, maxEdges: 4, maxFiles: 4, maxEvidence: 4 },
      })

      expect(result.packet.pipelineIDs).toEqual([pipelineID("pipeline-target-flow")])
      expect(result.packet.symbols).toContain("Target.run")
      expect(result.packet.pipelineIDs).not.toContain("pipeline-other-flow")
      expect(JSON.stringify(result.packet).length).toBeLessThanOrEqual(2_000)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("renders cycles deterministically and exposes evidence", () => {
    const repository = repositoryID(`repo-${"e".repeat(32)}`)
    const first = node({ id: "node-first", name: "First" })
    const second = { ...node({ id: "node-second", name: "Second" }), repositoryID: repository }
    const base: RepositoryContext = {
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      manifest: {
        schemaVersion: CONTEXT_SCHEMA_VERSION,
        repositoryID: repository,
        displayName: "Cycle",
        identity: { vcs: "unknown", remotes: [], rootFingerprint: "cycle" },
        lastSeenPath: "/tmp/cycle",
        createdAt: 1,
        updatedAt: 1,
      },
      nodes: [{ ...first, repositoryID: repository }, second],
      edges: [
        {
          id: edgeID(`edge-${"1".repeat(32)}`),
          schemaVersion: CONTEXT_SCHEMA_VERSION,
          from: first.id,
          to: second.id,
          relation: "calls",
          repositoryID: repository,
          confidence: "SUPPORTED",
          status: "active",
          evidenceIDs: [],
        },
        {
          id: edgeID(`edge-${"2".repeat(32)}`),
          schemaVersion: CONTEXT_SCHEMA_VERSION,
          from: second.id,
          to: first.id,
          relation: "calls",
          repositoryID: repository,
          confidence: "SUPPORTED",
          status: "active",
          evidenceIDs: [],
        },
      ],
      pipelines: [
        {
          id: pipelineID("pipeline-cycle"),
          schemaVersion: CONTEXT_SCHEMA_VERSION,
          repositoryID: repository,
          name: "Cycle",
          kind: "runtime_pipeline",
          summary: "Cycle",
          status: "active",
          confidence: "SUPPORTED",
          entryPoints: [{ nodeID: first.id }],
          nodeIDs: [first.id, second.id],
          edgeIDs: [edgeID(`edge-${"1".repeat(32)}`), edgeID(`edge-${"2".repeat(32)}`)],
          constraints: [],
          unknowns: [],
          relatedPipelineIDs: [],
          ownerIDs: [],
          evidenceIDs: [],
        },
      ],
      components: [],
      evidence: [],
    }
    const firstRender = ContextRenderer.renderCompact(base, "pipeline-cycle")
    expect(firstRender).toBe(ContextRenderer.renderCompact(base, "pipeline-cycle"))
    expect(firstRender).toContain("↺")
  })

  test("parses context commands and requires explicit forget confirmation", () => {
    const parsed = ContextCommandService.parse('/context search "payment callback"')
    expect(parsed).toEqual({ command: "context", operation: "search", scope: "payment callback" })
    expect(ContextCommandService.parse("/explore_codebase packages/opencode")).toEqual({
      command: "explore",
      operation: "show",
      scope: "packages/opencode",
    })

    const fixture = openFixture()
    try {
      const pending = ContextCommandService.execute({
        root: fixture.root,
        command: `/context forget ${fixture.handle.repositoryID}`,
        store: fixture.store,
      })
      expect(pending.confirmationRequired).toBe(true)
      expect(fixture.store.load(fixture.handle.repositoryID)).toBeUndefined()
      const confirmed = ContextCommandService.execute({
        root: fixture.root,
        command: `/context forget ${fixture.handle.repositoryID}`,
        store: fixture.store,
        confirmForget: true,
      })
      expect(confirmed.changed).toBe(true)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test("promotes only current source-backed owner findings", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-owner-"))
    try {
      mkdirSync(path.join(root, "src"), { recursive: true })
      const source = "export const current = true"
      writeFileSync(path.join(root, "src", "current.ts"), source)
      const store = ContextStore.memory()
      const handle = ContextService.open({ root, store })
      const packet = ContextOrchestration.packet({ store, workdir: root, prompt: "fix current flow" })
      expect(packet).toBeUndefined()
      const prompt = ContextOrchestration.ownerPrompt({
        workdir: root,
        prompt: "fix current flow",
        taskPrompt: "fix current flow",
        routeInstructions: "stay in owner scope",
      })
      expect(prompt).toContain("stay in owner scope")
      expect(prompt).toContain("ocx_context_findings")
      expect(
        ContextOrchestration.promoteTask({
          workdir: root,
          store,
          taskID: "owner-task",
          taskPrompt: "fix current flow",
          resultText: "no finding",
        }).promoted,
      ).toBe(false)
      const result = ContextOrchestration.promoteTask({
        workdir: root,
        store,
        taskID: "owner-task",
        ownerID: "owner-runtime",
        taskPrompt: "fix current flow",
        resultText: `<ocx_context_findings>${JSON.stringify([{ subject: "Current", relation: "calls", object: "Worker", confidence: "VERIFIED", evidence: [{ file: "src/current.ts", symbol: "current", contentHash: ContextFreshnessTracker.fingerprint(source), observation: "Current calls Worker." }], scope: "current flow" }])}</ocx_context_findings>`,
      })
      expect(result.promoted).toBe(true)
      expect(result.packet?.ownerIDs).toContain("owner-runtime")
      expect(store.load(handle.repositoryID)?.evidence).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
