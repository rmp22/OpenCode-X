import { describe, expect, test } from "bun:test"
import { TaskModel } from "../../src/ocx/task-model"

describe("OCX task model", () => {
  test("distinguishes coding from non-coding workflows", () => {
    expect(TaskModel.taskKind("coding")).toBe("coding")
    expect(TaskModel.taskKind("research")).toBe("research")
    expect(TaskModel.taskKind("git")).toBe("git")
    expect(TaskModel.taskKind("automation")).toBe("automation")
    expect(TaskModel.taskKind("review")).toBe("review")
  })

  test("maps phase names to generic stages", () => {
    expect(TaskModel.stageKind("context")).toBe("understand")
    expect(TaskModel.stageKind("change")).toBe("act")
    expect(TaskModel.stageKind("validate")).toBe("validate")
    expect(TaskModel.stageKind("deliver")).toBe("deliver")
    expect(TaskModel.stageKind("needs_input")).toBe("wait")
  })

  test("does not force an execution plan on research, git, or automation", () => {
    expect(TaskModel.requiresExecutionPlan("coding")).toBe(true)
    expect(TaskModel.requiresExecutionPlan("research")).toBe(false)
    expect(TaskModel.requiresExecutionPlan("git")).toBe(false)
    expect(TaskModel.requiresExecutionPlan("automation")).toBe(false)
  })
})
