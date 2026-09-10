import { describe, expect, test } from "bun:test"
import { WorkflowEvidence } from "../../src/ocx/workflow-evidence"

const phases = [
  { id: "context", goal: "inspect", gate: "targets, callers, and repo rules read" },
  { id: "contract", goal: "structure", gate: "plan, architecture, non-goals, and checks written" },
  { id: "codegen", goal: "implement", gate: "diff matches plan" },
]

describe("runtime workflow evidence", () => {
  test("accepted context-ready plan satisfies the context gate", () => {
    const workflow = { workflow: "codegen", phase: "context", phases }
    const result = WorkflowEvidence.forAction({
      workflow,
      state: {
        workflow: "codegen",
        phase: "context",
        phases,
        plan: {
          revision: 1,
          goal: "build",
          contextReady: true,
          workstreams: [],
          mutations: [],
          evidence: [],
        },
      } as never,
    })
    expect(result.completedObligations).toEqual(["targets, callers, and repo rules read"])
  })

  test("an accepted plan satisfies the planning stage without requiring structure", () => {
    const workflow = { workflow: "codegen", phase: "contract", phases }
    const result = WorkflowEvidence.forAction({
      workflow,
      state: {
        workflow: "codegen",
        phase: "contract",
        phases,
        plan: {
          revision: 1,
          goal: "build",
          contextReady: true,
          workstreams: [],
          mutations: [],
          evidence: [],
        },
      } as never,
    })
    expect(result.completedObligations).toEqual(["plan, architecture, non-goals, and checks written"])
  })
})
