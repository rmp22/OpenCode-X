import { describe, expect, test } from "bun:test"
import {
  createWorkModel,
  activateStep,
  completeStep,
  renderWorkModel,
  workstreamToWorkModel,
  todosToWorkModel,
  detectDependencyCycles,
  areDependenciesSatisfied,
  canCompleteStep,
  updateCheckStatus,
} from "@/ocx/work"

describe("Canonical WorkModel & Adapters", () => {
  test("creates work model and computes deterministic progress", () => {
    const model = createWorkModel({
      id: "wm_test",
      sessionID: "sess_1",
      goal: "Implement Authentication",
      workstreams: [
        {
          id: "ws_1",
          title: "Backend Auth",
          status: "in_progress",
          steps: [
            {
              id: "step_1",
              title: "Setup JWT",
              action: "Create JWT signer",
              status: "completed",
              checks: [{ id: "c1", description: "Tokens sign correctly", status: "pass" }],
            },
            {
              id: "step_2",
              title: "Token refresh",
              action: "Implement refresh handler",
              status: "in_progress",
              checks: [{ id: "c2", description: "Refresh rotates token", status: "pass" }],
            },
          ],
        },
        {
          id: "ws_2",
          title: "Frontend UI",
          status: "pending",
          steps: [
            {
              id: "step_3",
              title: "Login form",
              action: "Create Login component",
              status: "pending",
              checks: [],
            },
            {
              id: "step_4",
              title: "Session guard",
              action: "Add AuthProvider",
              status: "pending",
              checks: [],
            },
          ],
        },
      ],
    })

    expect(model.progress).toBe(0.25)

    const activated = activateStep(model, "step_3")
    expect(activated.currentStepId).toBe("step_3")
    expect(activated.workstreams[1].steps[0].status).toBe("in_progress")

    const completed = completeStep(activated, "step_2")
    expect(completed.progress).toBe(0.5)

    const rendered = renderWorkModel(completed)
    expect(rendered).toContain("=== WORK MODEL: Implement Authentication (Progress: 50%) ===")
    expect(rendered).toContain("[✓] Setup JWT: Create JWT signer")
    expect(rendered).toContain("[►] Login form: Create Login component")
  })

  test("adapts legacy workstream array into WorkModel", () => {
    const legacy = [
      {
        id: "ws_legacy",
        goal: "Build feature",
        status: "in_progress",
        steps: [
          {
            id: "step_a",
            title: "Task A",
            action: "Do Task A",
            status: "completed",
            checks: [{ description: "Check A", status: "pass" }],
          },
          {
            id: "step_b",
            title: "Task B",
            action: "Do Task B",
            status: "pending",
            checks: [{ description: "Check B", status: "pending" }],
          },
        ],
      },
    ]

    const model = workstreamToWorkModel("sess_legacy", "Build feature", legacy)
    expect(model.workstreams.length).toBe(1)
    expect(model.workstreams[0].steps.length).toBe(2)
    expect(model.progress).toBe(0.5)
  })

  test("adapts todo list into WorkModel", () => {
    const todos = [
      { content: "First task", status: "completed" },
      { content: "Second task", status: "in_progress" },
      { content: "Third task", status: "pending" },
    ]

    const model = todosToWorkModel("sess_todos", "Todo Goal", todos)
    expect(model.workstreams[0].steps.length).toBe(3)
    expect(model.progress).toBe(0.33)
  })

  test("hierarchy: supports Goal -> Workstream -> WorkItem -> Check", () => {
    const model = createWorkModel({
      id: "wm_hier",
      sessionID: "sess_hier",
      goal: "Full System Goal",
      goals: [
        {
          id: "g_1",
          title: "Primary Goal",
          status: "in_progress",
          workstreamIds: ["ws_1"],
        },
      ],
      workstreams: [
        {
          id: "ws_1",
          goalId: "g_1",
          title: "Stream 1",
          status: "in_progress",
          steps: [
            {
              id: "item_1",
              workstreamId: "ws_1",
              title: "Item 1",
              action: "Action 1",
              status: "ready",
              checks: [
                { id: "chk_1", itemId: "item_1", description: "Acceptance check 1", status: "pending" },
              ],
            },
          ],
        },
      ],
    })

    expect(model.goals?.[0].id).toBe("g_1")
    expect(model.workstreams[0].goalId).toBe("g_1")
    expect(model.workstreams[0].steps[0].checks[0].itemId).toBe("item_1")
  })

  test("verification-gated completion rejects unpassed checks without waiver", () => {
    const model = createWorkModel({
      id: "wm_gate",
      sessionID: "sess_gate",
      goal: "Gate Check Goal",
      workstreams: [
        {
          id: "ws_gate",
          title: "Gate Stream",
          status: "in_progress",
          steps: [
            {
              id: "step_strict",
              title: "Strict Step",
              action: "Run critical code",
              status: "in_progress",
              checks: [
                { id: "c_fail", description: "Must pass tests", status: "pending" },
              ],
            },
          ],
        },
      ],
    })

    const checkRes = canCompleteStep(model.workstreams[0].steps[0])
    expect(checkRes.allowed).toBe(false)
    expect(checkRes.reason).toContain("unpassed check")

    expect(() => completeStep(model, "step_strict")).toThrow()

    const updated = updateCheckStatus(model, "step_strict", "c_fail", "pass", "ev_123")
    const completed = completeStep(updated, "step_strict", { evidenceIds: ["ev_123"] })
    expect(completed.workstreams[0].steps[0].status).toBe("completed")
    expect(completed.workstreams[0].steps[0].evidenceIds).toContain("ev_123")
  })

  test("waiver allows completion when explicit reason is supplied", () => {
    const model = createWorkModel({
      id: "wm_waive",
      sessionID: "sess_waive",
      goal: "Waiver Goal",
      workstreams: [
        {
          id: "ws_waive",
          title: "Waiver Stream",
          status: "in_progress",
          steps: [
            {
              id: "step_waived",
              title: "Waived Step",
              action: "External integration",
              status: "in_progress",
              checks: [
                { id: "c_ext", description: "External service reachable", status: "pending" },
              ],
            },
          ],
        },
      ],
    })

    const completed = completeStep(model, "step_waived", {
      waiverReason: "Approved manual test in staging env",
    })
    expect(completed.workstreams[0].steps[0].status).toBe("completed")
    expect(completed.workstreams[0].steps[0].waiverReason).toBe("Approved manual test in staging env")
  })

  test("dependencies and cycle detection", () => {
    const validItems = [
      { id: "a", dependsOn: [] },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
    ]
    expect(detectDependencyCycles(validItems)).toBe(false)

    const cyclicItems = [
      { id: "x", dependsOn: ["z"] },
      { id: "y", dependsOn: ["x"] },
      { id: "z", dependsOn: ["y"] },
    ]
    expect(detectDependencyCycles(cyclicItems)).toBe(true)

    const steps = [
      { id: "a", title: "A", action: "A", status: "completed" as const, checks: [] },
      { id: "b", title: "B", action: "B", status: "in_progress" as const, checks: [] },
    ]
    expect(areDependenciesSatisfied({ dependsOn: ["a"] }, steps)).toBe(true)
    expect(areDependenciesSatisfied({ dependsOn: ["b"] }, steps)).toBe(false)
  })
})
