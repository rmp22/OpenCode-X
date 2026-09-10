import { describe, expect, test } from "bun:test"
import { createL2WorkflowGraph, createPayloadOffloader } from "@/ocx/memory/offload"

describe("L2 Workflow Graph and Payload Offloader", () => {
  test("tracks L2 workflow state transitions and renders Mermaid DAG", () => {
    const graph = createL2WorkflowGraph()

    graph.addNode({ id: "step_1", title: "Analyze architecture", target: "docs/spec.md", status: "pending" })
    graph.addNode({ id: "step_2", title: "Implement code", target: "src/main.ts", status: "pending" })
    graph.addEdge("step_1", "step_2", "next")

    expect(graph.getNode("step_1")?.status).toBe("pending")

    const transitioned = graph.transitionNode("step_1", "in_progress")
    expect(transitioned).toBe(true)
    expect(graph.getNode("step_1")?.status).toBe("in_progress")

    graph.transitionNode("step_1", "completed")
    graph.transitionNode("step_2", "in_progress")

    const mermaid = graph.renderMermaid()
    expect(mermaid).toContain("graph TD")
    expect(mermaid).toContain('step_1["Analyze architecture (docs/spec.md) [completed]"]')
    expect(mermaid).toContain('step_2["Implement code (src/main.ts) [in_progress]"]')
    expect(mermaid).toContain('step_1 -->|"next"| step_2')
    expect(mermaid).toContain("class step_1 status_completed")
    expect(mermaid).toContain("class step_2 status_in_progress")

    const summary = graph.renderCompactSummary()
    expect(summary).toContain("[COMPLETED] step_1: Analyze architecture -> docs/spec.md")
    expect(summary).toContain("[IN_PROGRESS] step_2: Implement code -> src/main.ts")
  })

  test("offloads large tool outputs above threshold and retrieves them", () => {
    const offloader = createPayloadOffloader({ thresholdBytes: 100, maxPreviewLength: 40 })

    const shortContent = "short output"
    expect(offloader.shouldOffload(shortContent)).toBe(false)

    const longContent = "A".repeat(500)
    expect(offloader.shouldOffload(longContent)).toBe(true)

    const sessionID = "ses_offload_test"
    const { stub, record } = offloader.offload(sessionID, "bash", longContent)

    expect(stub).toContain("[OFFLOADED: id=")
    expect(stub).toContain("tool=bash")
    expect(record.size).toBe(500)
    expect(record.sessionID).toBe(sessionID)

    const retrieved = offloader.retrieve(record.id)
    expect(retrieved).toBe(longContent)

    const list = offloader.listBySession(sessionID)
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(record.id)

    const purged = offloader.purgeSession(sessionID)
    expect(purged).toBe(1)
    expect(offloader.retrieve(record.id)).toBeUndefined()
  })
})
