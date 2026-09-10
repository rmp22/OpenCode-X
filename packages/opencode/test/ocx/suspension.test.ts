import { describe, expect, test } from "bun:test"
import { SuspensionManager } from "@/ocx/suspension"
import { GraphEngine } from "@/ocx/graph"

describe("Typed Suspensions and Resume Lifecycle", () => {
  test("creates and lists active suspensions", () => {
    const mgr = new SuspensionManager()
    const sessionID = "sess_susp_1"

    const s1 = mgr.suspend({
      sessionID,
      nodeId: "plan",
      kind: "user_input",
      prompt: "Which database do you prefer?",
    })
    expect(s1.status).toBe("active")
    expect(s1.kind).toBe("user_input")

    const active = mgr.activeSuspensions(sessionID)
    expect(active.length).toBe(1)
    expect(active[0].id).toBe(s1.id)
  })

  test("validates resume payload against kind", () => {
    const mgr = new SuspensionManager()
    const sessionID = "sess_susp_2"

    const inputSusp = mgr.suspend({
      sessionID,
      nodeId: "plan",
      kind: "user_input",
      prompt: "Choice?",
    })

    const invalidInputResume = mgr.resume(sessionID, inputSusp.id, { foo: 123 })
    expect(invalidInputResume.success).toBe(false)

    const validInputResume = mgr.resume(sessionID, inputSusp.id, "PostgreSQL")
    expect(validInputResume.success).toBe(true)

    const permSusp = mgr.suspend({
      sessionID,
      nodeId: "exec",
      kind: "permission",
      prompt: "Allow rm -rf?",
    })
    const invalidPermResume = mgr.resume(sessionID, permSusp.id, "yes")
    expect(invalidPermResume.success).toBe(false)

    const validPermResume = mgr.resume(sessionID, permSusp.id, { approved: true })
    expect(validPermResume.success).toBe(true)
  })

  test("cancelling a suspension removes it from active list", () => {
    const mgr = new SuspensionManager()
    const sessionID = "sess_susp_3"
    const record = mgr.suspend({
      sessionID,
      nodeId: "audit",
      kind: "review_approval",
      prompt: "Sign off?",
    })
    expect(mgr.activeSuspensions(sessionID).length).toBe(1)

    const cancelled = mgr.cancel(sessionID, record.id)
    expect(cancelled).toBe(true)
    expect(mgr.activeSuspensions(sessionID).length).toBe(0)
  })

  test("GraphEngine integration with suspension lifecycle", () => {
    const graph = {
      id: "graph_with_susp",
      pipelineId: "code-mutation-pipeline",
      initialNodeId: "plan",
      terminalNodeIds: ["complete"],
      nodes: [
        { id: "plan", label: "Plan", kind: "initial" as const },
        { id: "execute", label: "Execute", kind: "intermediate" as const },
        { id: "complete", label: "Complete", kind: "terminal" as const },
      ],
      edges: [
        { from: "plan", to: "execute" },
        { from: "execute", to: "complete" },
      ],
    }

    const sessionID = `sess_graph_susp_${Date.now()}`
    const engine = new GraphEngine({ graph, sessionID })

    const suspResult = engine.suspend({
      kind: "user_input",
      detail: "Clarify requirements",
      timestamp: Date.now(),
    })
    expect(suspResult.status).toBe("suspended")
    expect(engine.getCurrentNode()).toBe("plan")

    const advanceResult = engine.transition("execute")
    expect(advanceResult.status).toBe("advanced")
    expect(engine.getCurrentNode()).toBe("execute")
  })
})
