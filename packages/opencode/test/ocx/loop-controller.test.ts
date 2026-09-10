import { describe, expect, test } from "bun:test"
import { LoopController } from "@/ocx/loops"

describe("Unified LoopController Escalation Ladder", () => {
  test("level 0 for clean execution", () => {
    const controller = new LoopController()
    controller.recordToolCall("read", "file1.ts")
    controller.recordToolCall("edit", "file1.ts")
    controller.recordToolCall("bash", "bun test")

    const action = controller.evaluate()
    expect(action.level).toBe(0)
    expect(action.kind).toBe("none")
  })

  test("level 1 advisory on 2 identical tool calls", () => {
    const controller = new LoopController()
    controller.recordToolCall("read", "file1.ts")
    controller.recordToolCall("read", "file1.ts")

    const action = controller.evaluate()
    expect(action.level).toBe(1)
    expect(action.kind).toBe("advisory")
    if (action.level === 1) {
      expect(action.message).toContain("Notice: repeated call")
    }
  })

  test("level 2 strict instruction and tool locking on 3 identical tool calls", () => {
    const controller = new LoopController()
    controller.recordToolCall("read", "file1.ts")
    controller.recordToolCall("read", "file1.ts")
    controller.recordToolCall("read", "file1.ts")

    const action = controller.evaluate()
    expect(action.level).toBe(2)
    expect(action.kind).toBe("strict_instruction")
    if (action.level === 2) {
      expect(action.lockedTools).toEqual(["read"])
    }
  })

  test("level 3 suspension on 5 consecutive errors", () => {
    const controller = new LoopController()
    for (let i = 0; i < 5; i++) {
      controller.recordError("bash")
    }

    const action = controller.evaluate()
    expect(action.level).toBe(3)
    expect(action.kind).toBe("suspension")
    if (action.level === 3) {
      expect(action.reason).toBe("circuit_breaker")
    }
  })

  test("level 4 abort on 4 identical consecutive calls", () => {
    const controller = new LoopController()
    controller.recordToolCall("write", "foo.ts:content")
    controller.recordToolCall("write", "foo.ts:content")
    controller.recordToolCall("write", "foo.ts:content")
    controller.recordToolCall("write", "foo.ts:content")

    const action = controller.evaluate()
    expect(action.level).toBe(4)
    expect(action.kind).toBe("abort")
    if (action.level === 4) {
      expect(action.message).toContain("Persistent infinite loop detected")
    }
  })

  test("detects all canonical loop patterns", () => {
    const c1 = new LoopController()
    c1.recordToolCall("bash", "git status")
    c1.recordToolCall("bash", "git status")
    expect(c1.detectPattern()).toBe("identical_tool")

    const c2 = new LoopController()
    c2.recordRead("target.ts")
    c2.recordRead("target.ts")
    c2.recordRead("target.ts")
    expect(c2.detectPattern()).toBe("read_thrash")

    const c3 = new LoopController()
    c3.recordError("err1")
    c3.recordError("err2")
    c3.recordError("err3")
    expect(c3.detectPattern()).toBe("error_cycle")

    const c4 = new LoopController()
    c4.recordNoProgressTurn()
    c4.recordNoProgressTurn()
    expect(c4.detectPattern()).toBe("no_progress_turn")
  })

  test("escalates through all 4 ladder levels", () => {
    const controller = new LoopController()
    const pattern = "identical_tool" as const

    const l1 = controller.escalateLadder(1, pattern)
    expect(l1.level).toBe(1)
    expect(l1.kind).toBe("advisory")

    const l2 = controller.escalateLadder(2, pattern)
    expect(l2.level).toBe(2)
    expect(l2.kind).toBe("strict_instruction")
    if (l2.level === 2) {
      expect(l2.lockedTools).toContain("read")
    }

    const l3 = controller.escalateLadder(3, pattern)
    expect(l3.level).toBe(3)
    expect(l3.kind).toBe("strategy_pivot")
    if (l3.level === 3) {
      expect(l3.rollbackRequested).toBe(true)
      expect(l3.alternativeStrategy).toBe("parameter_variation")
    }

    const l4 = controller.escalateLadder(4, pattern)
    expect(l4.level).toBe(4)
    expect(l4.kind).toBe("suspension")
  })

  test("generates concrete recovery suggestions for each pattern", () => {
    const controller = new LoopController()

    const rIdentical = controller.generateRecoveryAction("identical_tool")
    expect(rIdentical.strategy).toBe("parameter_variation")
    expect(rIdentical.alternativeTools).toContain("task")

    const rThrash = controller.generateRecoveryAction("read_thrash")
    expect(rThrash.strategy).toBe("bounded_context_synthesis")
    expect(rThrash.alternativeTools).toContain("edit")

    const rError = controller.generateRecoveryAction("error_cycle")
    expect(rError.strategy).toBe("hypothesis_inversion")
    expect(rError.alternativeTools).toContain("question")

    const rNoProg = controller.generateRecoveryAction("no_progress_turn")
    expect(rNoProg.strategy).toBe("subgoal_decomposition")
    expect(rNoProg.alternativeTools).toContain("todowrite")
  })

  test("exhausts retry budget on attempts and cost limits", () => {
    const controller = new LoopController()
    controller.setBudget({ maxAttempts: 3, maxCost: 5.0 })

    controller.recordInvocation("bash", "ls", "ok", false, 1.0)
    expect(controller.checkBudget().isExhausted).toBe(false)

    controller.recordInvocation("bash", "pwd", "ok", false, 1.0)
    expect(controller.checkBudget().isExhausted).toBe(false)

    const action = controller.recordInvocation("bash", "echo", "ok", false, 1.0)
    expect(controller.checkBudget().isExhausted).toBe(true)
    expect(action.level).toBe(4)
    if (action.level === 4) {
      expect(action.kind).toBe("suspension")
      expect(action.message).toContain("Max attempts exceeded")
    }

    const cCost = new LoopController()
    cCost.setBudget({ maxAttempts: 100, maxCost: 2.0 })
    cCost.recordInvocation("bash", "cmd1", "ok", false, 1.0)
    const costAction = cCost.recordInvocation("bash", "cmd2", "ok", false, 1.5)
    expect(costAction.level).toBe(4)
    if (costAction.level === 4) {
      expect(costAction.message).toContain("Max budget cost exceeded")
    }
  })
})
