import { describe, expect, test } from "bun:test"
import {
  type ExecutionGraph,
  GraphEngine,
  validateGraph,
  FileCheckpointStorage,
} from "@/ocx/graph"
import { rmSync, existsSync } from "node:fs"
import { join } from "node:path"

describe("GraphEngine validation & durability", () => {
  const validGraph: ExecutionGraph = {
    id: "test-pipeline-graph",
    pipelineId: "code-mutation-pipeline",
    initialNodeId: "plan",
    terminalNodeIds: ["complete"],
    nodes: [
      { id: "plan", label: "Plan", kind: "initial" },
      { id: "execute", label: "Execute", kind: "intermediate" },
      { id: "verify", label: "Verify", kind: "intermediate" },
      { id: "complete", label: "Complete", kind: "terminal" },
    ],
    edges: [
      { from: "plan", to: "execute" },
      { from: "execute", to: "verify" },
      { from: "verify", to: "complete" },
      { from: "verify", to: "execute", isRetry: true },
    ],
  }

  test("validates valid DAG graph with explicit retry edge", () => {
    const errors = validateGraph(validGraph)
    expect(errors).toEqual([])
  })

  test("detects cyclic graph in forward edges", () => {
    const cyclicGraph: ExecutionGraph = {
      ...validGraph,
      edges: [
        { from: "plan", to: "execute" },
        { from: "execute", to: "verify" },
        { from: "verify", to: "plan" },
        { from: "verify", to: "complete" },
      ],
    }
    const errors = validateGraph(cyclicGraph)
    expect(errors.some((e) => e.code === "cycle_detected")).toBe(true)
  })

  test("detects unreachable terminal nodes", () => {
    const unreachableGraph: ExecutionGraph = {
      ...validGraph,
      terminalNodeIds: ["complete", "unreachable_end"],
      nodes: [
        ...validGraph.nodes,
        { id: "unreachable_end", label: "Unreachable", kind: "terminal" },
      ],
    }
    const errors = validateGraph(unreachableGraph)
    expect(errors.some((e) => e.code === "unreachable_terminal")).toBe(true)
  })

  test("detects dead-end non-terminal nodes", () => {
    const deadEndGraph: ExecutionGraph = {
      ...validGraph,
      nodes: [
        ...validGraph.nodes,
        { id: "stuck_node", label: "Stuck", kind: "intermediate" },
      ],
      edges: [
        ...validGraph.edges,
        { from: "plan", to: "stuck_node" },
      ],
    }
    const errors = validateGraph(deadEndGraph)
    expect(errors.some((e) => e.code === "dead_end_node")).toBe(true)
  })

  test("enforces transition rules: valid transitions advance, invalid are rejected", () => {
    const engine = new GraphEngine({
      graph: validGraph,
      sessionID: `test-session-${Date.now()}`,
    })
    expect(engine.getCurrentNode()).toBe("plan")

    const invalid = engine.transition("complete")
    expect(invalid.status).toBe("rejected")

    const validAdvance = engine.transition("execute")
    expect(validAdvance.status).toBe("advanced")
    expect(engine.getCurrentNode()).toBe("execute")

    const verifyAdvance = engine.transition("verify")
    expect(verifyAdvance.status).toBe("advanced")

    const retryAdvance = engine.transition("execute")
    expect(retryAdvance.status).toBe("advanced")

    engine.transition("verify")
    const terminal = engine.transition("complete")
    expect(terminal.status).toBe("completed")
  })

  test("persists checkpoints across engine instances for same session", () => {
    const tmpDir = join("/tmp", `chk_test_${Date.now()}`)
    const storage = new FileCheckpointStorage(tmpDir)
    const sessionID = `sess_recovery_${Date.now()}`

    const engine1 = new GraphEngine({
      graph: validGraph,
      sessionID,
      storage,
    })
    engine1.transition("execute", { diff: "+1 line" })
    engine1.addEvidence({
      id: "ev1",
      nodeId: "execute",
      kind: "test_pass",
      detail: "1 test passed",
      timestamp: Date.now(),
    })

    const engine2 = new GraphEngine({
      graph: validGraph,
      sessionID,
      storage,
    })
    expect(engine2.getCurrentNode()).toBe("execute")
    expect(engine2.getVisitedNodes()).toContain("execute")
    expect(engine2.getAccumulatedEvidence().length).toBe(1)

    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("supports dynamic node insertion and runtime edge addition", () => {
    const engine = new GraphEngine({
      graph: validGraph,
      sessionID: `test-dynamic-${Date.now()}`,
    })

    engine.addNode({
      id: "research",
      label: "Research",
      kind: "intermediate",
      allowedTools: ["websearch", "read"],
      permissions: ["read_network"],
      budgetConstraints: { maxTokens: 5000 },
    })

    engine.addEdge({ from: "plan", to: "research" })
    engine.addEdge({ from: "research", to: "execute" })

    expect(engine.getNode("research")).toBeDefined()
    expect(engine.getNode("research")?.permissions).toContain("read_network")

    const resAdv = engine.transition("research")
    expect(resAdv.status).toBe("advanced")
    expect(engine.getCurrentNode()).toBe("research")

    const toExec = engine.transition("execute")
    expect(toExec.status).toBe("advanced")
    expect(engine.getCurrentNode()).toBe("execute")
  })

  test("evaluates conditional edge traversal", () => {
    const engine = new GraphEngine({
      graph: validGraph,
      sessionID: `test-cond-${Date.now()}`,
    })

    engine.addNode({
      id: "fast_track",
      label: "Fast Track",
      kind: "intermediate",
    })
    engine.addEdge({
      from: "plan",
      to: "fast_track",
      evaluateCondition: (ctx) => ctx.isTrivial === true,
    })

    const rejectTransition = engine.transition("fast_track", undefined, { isTrivial: false })
    expect(rejectTransition.status).toBe("rejected")

    const allowTransition = engine.transition("fast_track", undefined, { isTrivial: true })
    expect(allowTransition.status).toBe("advanced")
    expect(engine.getCurrentNode()).toBe("fast_track")
  })

  test("handles suspension and resume lifecycle", () => {
    const engine = new GraphEngine({
      graph: validGraph,
      sessionID: `test-susp-${Date.now()}`,
    })

    const suspResult = engine.suspend({
      kind: "approval",
      detail: "Awaiting user approval for high-impact action",
      timestamp: Date.now(),
    })
    expect(suspResult.status).toBe("suspended")
    expect(engine.getSuspensionReason()?.kind).toBe("approval")

    const resumeResult = engine.resume({ approved: true })
    expect(resumeResult.status).toBe("resumed")
    expect(engine.getSuspensionReason()).toBeUndefined()
  })

  test("enforces required evidence before exit and suspends with verification_failure", () => {
    const evidenceGraph: ExecutionGraph = {
      ...validGraph,
      nodes: [
        { id: "plan", label: "Plan", kind: "initial", requiredEvidence: ["spec_approved"] },
        { id: "execute", label: "Execute", kind: "intermediate" },
        { id: "verify", label: "Verify", kind: "intermediate" },
        { id: "complete", label: "Complete", kind: "terminal" },
      ],
    }
    const engine = new GraphEngine({
      graph: evidenceGraph,
      sessionID: `test-ev-req-${Date.now()}`,
    })

    const susp = engine.transition("execute")
    expect(susp.status).toBe("suspended")
    expect(engine.getSuspensionReason()?.kind).toBe("verification_failure")

    engine.resume()
    engine.addEvidence({
      id: "ev_spec",
      nodeId: "plan",
      kind: "spec_approved",
      detail: "Spec validated",
      timestamp: Date.now(),
    })

    const adv = engine.transition("execute")
    expect(adv.status).toBe("advanced")
    expect(engine.getCurrentNode()).toBe("execute")
  })

  test("supports rollback to previous node and explicit target node", () => {
    const engine = new GraphEngine({
      graph: validGraph,
      sessionID: `test-rb-${Date.now()}`,
    })

    engine.transition("execute")
    engine.transition("verify")
    expect(engine.getCurrentNode()).toBe("verify")

    const rb1 = engine.rollback()
    expect(rb1.status).toBe("rolled_back")
    expect(engine.getCurrentNode()).toBe("execute")

    engine.transition("verify")
    const rbTarget = engine.rollback("plan")
    expect(rbTarget.status).toBe("rolled_back")
    expect(engine.getCurrentNode()).toBe("plan")
  })

  test("supports dynamic replanning with branch expansion and cancellation", () => {
    const engine = new GraphEngine({
      graph: validGraph,
      sessionID: `test-replan-${Date.now()}`,
    })

    engine.expandBranch(
      "plan",
      [
        { id: "sub_a", label: "Subtask A", kind: "intermediate" },
        { id: "sub_b", label: "Subtask B", kind: "intermediate" },
      ],
      [
        { from: "plan", to: "sub_a" },
        { from: "sub_a", to: "sub_b" },
        { from: "sub_b", to: "execute" },
      ],
    )

    expect(engine.getNode("sub_a")).toBeDefined()
    expect(engine.getNode("sub_b")).toBeDefined()

    engine.cancelPending(["sub_b"])
    expect(engine.getNode("sub_b")).toBeUndefined()
  })

  test("rejects self-referential edges in validation and dynamic addEdge", () => {
    const selfLoopGraph: ExecutionGraph = {
      ...validGraph,
      edges: [
        ...validGraph.edges,
        { from: "plan", to: "plan" },
      ],
    }
    const errors = validateGraph(selfLoopGraph)
    expect(errors.some((e) => e.code === "self_referential_edge")).toBe(true)

    const engine = new GraphEngine({
      graph: validGraph,
      sessionID: `test-self-edge-${Date.now()}`,
    })
    expect(() => engine.addEdge({ from: "plan", to: "plan" })).toThrow("Cannot add self-referential edge")
  })
})
