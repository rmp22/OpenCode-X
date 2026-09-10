import { describe, expect, test } from "bun:test"
import { NodeContextAssembler } from "@/ocx/prompt/assembler"

describe("NodeContextAssembler", () => {
  test("assembles prompt blocks adhering to priority tiers and token budgets", () => {
    const assembler = new NodeContextAssembler()

    assembler.addBlock({
      id: "b-history",
      title: "Historical Transcript",
      priority: 4,
      content: "turn 1 ... turn 2",
    })

    assembler.addBlock({
      id: "b-safety",
      title: "Safety Invariants",
      priority: 0,
      content: "Never expose secrets. Read before edit.",
    })

    assembler.addBlock({
      id: "b-task",
      title: "Active Task",
      priority: 1,
      content: "Implement streaming hot path optimization.",
    })

    const assembled = assembler.assemble({ maxTokens: 50 })
    expect(assembled.includedBlocks.length).toBeGreaterThanOrEqual(2)
    expect(assembled.includedBlocks[0].id).toBe("b-safety")
    expect(assembled.includedBlocks[1].id).toBe("b-task")
    expect(assembled.fullPrompt).toContain("=== SAFETY INVARIANTS ===")
    expect(assembled.fullPrompt).toContain("=== ACTIVE TASK ===")
  })
})
