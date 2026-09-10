import { describe, expect, test } from "bun:test"
import { ContextGraph } from "../../src/ocx/context/graph"
import { RepositoryIdentityResolver } from "../../src/ocx/context/identity"
import {
  CONTEXT_SCHEMA_VERSION,
  edgeID,
  normalizeRelativePath,
  nodeID,
  parseRepositoryContext,
  pipelineID,
  repositoryID,
  type ContextEdge,
  type ContextNode,
  type PipelineContext,
  type RepositoryContext,
} from "../../src/ocx/context/types"

const repo = repositoryID(`repo-${"a".repeat(32)}`)

function node(id: string, name: string, metadata: ContextNode["metadata"] = {}): ContextNode {
  return {
    id: nodeID(id),
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    kind: "component",
    canonicalName: name,
    repositoryID: repo,
    metadata,
    confidence: "VERIFIED",
    status: "active",
    evidenceIDs: [],
    aliases: [],
  }
}

function edge(from: ContextNode["id"], to: ContextNode["id"]): ContextEdge {
  return {
    id: edgeID(`edge-${"b".repeat(32)}`),
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    from,
    to,
    relation: "calls",
    repositoryID: repo,
    confidence: "VERIFIED",
    status: "active",
    evidenceIDs: [],
  }
}

function context(nodes: readonly ContextNode[], edges: readonly ContextEdge[] = []): RepositoryContext {
  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    manifest: {
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      repositoryID: repo,
      displayName: "Fixture",
      identity: { vcs: "git", remotes: ["github.com/example/fixture"], rootFingerprint: "fixture" },
      lastSeenPath: "/tmp/fixture",
      createdAt: 1,
      updatedAt: 1,
    },
    nodes,
    edges,
    pipelines: [],
    components: [],
    evidence: [],
  }
}

describe("context domain", () => {
  test("keeps repository identity stable when the checkout path changes", () => {
    const first = RepositoryIdentityResolver.resolve({
      root: "/tmp/one/project",
      remotes: ["git@github.com:Example/Project.git"],
      rootFingerprint: "same",
    })
    const second = RepositoryIdentityResolver.resolve({
      root: "/work/two/project",
      remotes: ["https://github.com/example/project.git"],
      rootFingerprint: "changed-source",
    })
    const unrelated = RepositoryIdentityResolver.resolve({
      root: "/work/two/project",
      remotes: ["https://github.com/example/other.git"],
      rootFingerprint: "other",
    })

    expect(first.id).toBe(second.id)
    expect(first.id).not.toBe(unrelated.id)
    expect(RepositoryIdentityResolver.normalizeRemote("ssh://user@github.com/example/project.git")).toBe(
      "github.com/example/project",
    )
    expect(RepositoryIdentityResolver.normalizeRemote("https://token:secret@github.com/example/project.git")).toBe(
      "github.com/example/project",
    )
  })

  test("rejects repository escape paths", () => {
    expect(() => nodeID("bad id")).toThrow()
    expect(() => parseRepositoryContext({})).not.toThrow()
    expect(() => normalizeRelativePath("../outside.ts")).toThrow()
    expect(() => normalizeRelativePath("/outside.ts")).toThrow()
  })

  test("round trips a versioned repository context", () => {
    const value = context([node("node-service", "Service")])
    expect(parseRepositoryContext(JSON.parse(JSON.stringify(value)))).toEqual(value)
    expect(parseRepositoryContext({ ...value, schemaVersion: 2 })).toBeUndefined()
  })

  test("builds typed indexes and resolves aliases", () => {
    const service = {
      ...node("node-service", "Service", { file: "src/service.ts", symbol: "Service.run", owner: "owner-core" }),
      aliases: ["runtime service"],
    }
    const worker = node("node-worker", "Worker", { files: ["src/worker.ts"], symbols: ["Worker.run"] })
    const pipeline: PipelineContext = {
      id: pipelineID("pipeline-job"),
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      repositoryID: repo,
      name: "Job pipeline",
      kind: "runtime_pipeline",
      summary: "Runs jobs",
      status: "active",
      confidence: "VERIFIED",
      entryPoints: [{ nodeID: service.id }],
      nodeIDs: [service.id, worker.id],
      edgeIDs: [],
      constraints: [],
      unknowns: [],
      relatedPipelineIDs: [],
      ownerIDs: ["owner-core"],
      evidenceIDs: [],
    }
    const graph = ContextGraph.upsertPipeline(
      ContextGraph.upsertNode(ContextGraph.upsertNode(ContextGraph.create({ repositoryID: repo }), service), worker),
      pipeline,
    )
    const indexes = ContextGraph.buildIndexes(graph)

    expect(ContextGraph.findNode(graph, "runtime service")?.id).toBe(service.id)
    expect(indexes.fileToNodes.get("src/service.ts")).toEqual([service.id])
    expect(indexes.symbolToNodes.get("worker.run")).toEqual([worker.id])
    expect(indexes.pipelineToNodes.get(pipeline.id)).toEqual([service.id, worker.id])
    expect(indexes.ownerToEntries.get("owner-core")).toEqual([service.id, pipeline.id])
  })

  test("rejects self edges and traverses neighbors within the limit", () => {
    const first = node("node-first", "First")
    const second = node("node-second", "Second")
    const third = node("node-third", "Third")
    const base = ContextGraph.create({ repositoryID: repo })
    const withNodes = [first, second, third].reduce((graph, item) => ContextGraph.upsertNode(graph, item), base)
    expect(() => ContextGraph.upsertEdge(withNodes, edge(first.id, first.id))).toThrow("self edges")
    const one = edge(first.id, second.id)
    const two = { ...edge(second.id, third.id), id: edgeID(`edge-${"c".repeat(32)}`) }
    const graph = ContextGraph.upsertEdge(ContextGraph.upsertEdge(withNodes, one), two)

    expect(ContextGraph.neighbors(graph, first.id, 2, 1).map((item) => item.node.id)).toEqual([second.id])
    expect(ContextGraph.neighbors(graph, first.id, 2, 8).map((item) => item.node.id)).toEqual([second.id, third.id])
  })
})
