import { describe, expect, test } from "bun:test"
import { PromptGovernor, deduplicateBlocks } from "../../src/ocx/prompt-governor"
import { OCXPipeline } from "../../src/ocx/ocx-pipeline"

describe("Prompt Governor", () => {
  test("keeps playbook bodies out of catalog-only directives", () => {
    const pipeline = {
      changed: false,
      docs: [],
      polished: "",
      strategies: ["frontier", "browser"],
      notice: undefined,
      workflow: { name: "coding", phase: "plan", phases: [] },
    } as unknown as OCXPipeline.Result

    const planBlocks = OCXPipeline.directiveBlocks(pipeline, { includeBodies: false, includeCatalog: true })
    expect(planBlocks.some((block) => block.id === "strategies:bodies")).toBe(false)
    expect(planBlocks.some((block) => block.id === "strategies:catalog")).toBe(true)

    const nonPlanBlocks = OCXPipeline.directiveBlocks(pipeline, { includeBodies: false, includeCatalog: false })
    expect(nonPlanBlocks.some((block) => block.id === "strategies:bodies")).toBe(false)
    expect(nonPlanBlocks.some((block) => block.id === "strategies:catalog")).toBe(false)
  })

  test("hard token budget", () => {
    const gov = new PromptGovernor(100)
    const result = gov.govern([
      { source: "workflow", priority: 90, tokens: 60, content: "workflow" },
      { source: "practice_packs", priority: 30, tokens: 60, content: "practice" },
    ])
    expect(result.totalAdmitted).toBeLessThanOrEqual(100)
    expect(result.rejected.length).toBe(1)
  })

  test("deterministic priority", () => {
    const gov = new PromptGovernor(100)
    const result = gov.govern([
      { source: "practice_packs", priority: 30, tokens: 30, content: "low" },
      { source: "requirements", priority: 100, tokens: 30, content: "high" },
    ])
    expect(result.admitted[0].source).toBe("requirements")
  })

  test("duplicate rules/context removed", () => {
    const { unique, duplicates } = deduplicateBlocks([
      { source: "context", priority: 60, tokens: 10, content: "same" },
      { source: "context", priority: 60, tokens: 10, content: "same" },
    ])
    expect(unique.length).toBe(1)
    expect(duplicates).toBe(1)
  })

  test("metrics show source/token contribution", () => {
    const gov = new PromptGovernor(200)
    const result = gov.govern([
      { source: "workflow", priority: 90, tokens: 50, content: "w" },
      { source: "context", priority: 60, tokens: 30, content: "c" },
    ])
    expect(result.metrics["workflow"].admitted).toBe(50)
    expect(result.metrics["context"].admitted).toBe(30)
  })

  test("keeps hard constraints and current steps under pressure", () => {
    const gov = new PromptGovernor(20)
    const result = gov.govern([
      { source: "optional_knowledge", tokens: 40, content: "optional" },
      { source: "hard_constraint", tokens: 30, content: "do not read outside cwd", trimPolicy: "never" },
      { source: "current_step", tokens: 20, content: "edit the active target", trimPolicy: "never" },
    ])
    expect(result.admitted.map((block) => block.source)).toEqual(["hard_constraint", "current_step"])
    expect(result.rejected.map((block) => block.source)).toEqual(["optional_knowledge"])
  })

  test("keeps reasoning control under pressure", () => {
    const result = new PromptGovernor(1).govern([
      { source: "reasoning_control", tokens: 40, content: "runtime owns terminal state", trimPolicy: "never" },
      { source: "optional_knowledge", tokens: 40, content: "optional" },
    ])
    expect(result.admitted.map((block) => block.source)).toEqual(["reasoning_control"])
  })

  test("admits only one raw playbook body", () => {
    const result = new PromptGovernor(1000).govern([
      { source: "playbook", tokens: 2, content: "body one", trimPolicy: "never" },
      { source: "playbook", tokens: 2, content: "body two", trimPolicy: "never" },
    ])
    expect(result.admitted).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
  })

  test("playbook body with bounded trim policy respects token budget", () => {
    const result = new PromptGovernor(50).govern([
      { source: "hard_constraint", tokens: 30, content: "hard constraint", trimPolicy: "never" },
      { source: "playbook", tokens: 40, content: "big playbook body", trimPolicy: "bounded" },
    ])
    expect(result.admitted.map((block) => block.source)).toEqual(["hard_constraint"])
    expect(result.rejected.map((block) => block.source)).toEqual(["playbook"])
  })
})
