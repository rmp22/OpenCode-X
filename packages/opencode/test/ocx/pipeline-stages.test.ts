import { describe, expect, it } from "bun:test"
import { PipelineStageCoordinator } from "../../src/ocx/pipeline/stages"
import type { ExecutionGraph } from "../../src/ocx/graph/types"

const sampleGraph: ExecutionGraph = {
  id: "test-pipeline-graph",
  pipelineId: "test-pipeline",
  initialNodeId: "plan",
  terminalNodeIds: ["complete"],
  nodes: [
    {
      id: "plan",
      label: "Planning",
      kind: "initial",
      allowedTools: ["read", "glob", "grep"],
    },
    {
      id: "mutate",
      label: "Mutation",
      kind: "intermediate",
      allowedTools: ["edit", "write"],
    },
    {
      id: "repair",
      label: "Repair",
      kind: "intermediate",
      allowedTools: ["edit", "write"],
    },
    {
      id: "complete",
      label: "Complete",
      kind: "terminal",
      allowedTools: [],
    },
  ],
  edges: [
    { from: "plan", to: "mutate" },
    { from: "mutate", to: "repair" },
    { from: "mutate", to: "complete" },
    { from: "repair", to: "complete" },
  ],
}

describe("PipelineStageCoordinator", () => {
  it("initializes claims and executes checks", async () => {
    const coordinator = new PipelineStageCoordinator({
      graph: sampleGraph,
      sessionID: `stage-test-${Date.now()}`,
    })

    const checkRes = await coordinator.executeCheck("echo 'pipeline ready'")
    expect(checkRes.status).toBe("PASS")
    expect(checkRes.stdout.trim()).toBe("pipeline ready")

    const claim = coordinator.recordClaim({
      id: "claim_1",
      nodeId: "plan",
      assertion: "file exists",
      status: "asserted",
      evidenceIds: [],
      citations: [{ filePath: "package.json", lineNumber: 1 }],
      createdAt: Date.now(),
    })
    expect(claim.status).toBe("asserted")

    const validCitation = await coordinator.verifyClaimCitation({
      filePath: "package.json",
      lineNumber: 1,
    })
    expect(validCitation).toBe(true)
  })

  it("advances graph state and routes to repair on failure", () => {
    const coordinator = new PipelineStageCoordinator({
      graph: sampleGraph,
      sessionID: `stage-test-graph-${Date.now()}`,
    })

    const advanceResult = coordinator.advanceGraph("mutate")
    expect(advanceResult?.status).toBe("advanced")
    if (advanceResult?.status === "advanced") {
      expect(advanceResult.toNode).toBe("mutate")
    }

    const repairResult = coordinator.routeToRepair()
    expect(repairResult?.status).toBe("advanced")
    if (repairResult?.status === "advanced") {
      expect(repairResult.toNode).toBe("repair")
    }
  })

  it("evaluates tool policy via PolicyEngine", () => {
    const coordinator = new PipelineStageCoordinator({
      sessionID: `stage-policy-${Date.now()}`,
    })

    const readPolicy = coordinator.evaluateToolPolicy("read")
    expect(readPolicy.allowed).toBe(true)
  })
})
