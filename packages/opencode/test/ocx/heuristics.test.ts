import { describe, expect, test } from "bun:test"
import { OCXHeuristics } from "../../src/ocx/heuristics"

describe("static blocks", () => {
  test("intake guidance leaves routing and safety to the runtime", () => {
    const block = OCXHeuristics.intakePassBlock()
    expect(block).toContain("=== OCX INTAKE PASS ===")
    expect(block).toContain("call ocx_header with one wrapper string")
    expect(block).toContain("Call ocx_plan only when")
    expect(block).toContain("Workflow and phase guide sequencing")
    expect(block.endsWith("=== END OCX INTAKE PASS ===")).toBe(true)
  })

  test("known intents are exported for the header schema", () => {
    expect(OCXHeuristics.KNOWN_INTENTS).toContain("code")
    expect(OCXHeuristics.KNOWN_INTENTS).toContain("design")
  })

  test("core strategies are exported for playbook tool", () => {
    expect(OCXHeuristics.CORE_STRATEGIES).toContain("quality")
    expect(OCXHeuristics.CORE_STRATEGIES).toContain("engineering")
    expect(OCXHeuristics.CORE_STRATEGIES).not.toContain("write")
  })
})
