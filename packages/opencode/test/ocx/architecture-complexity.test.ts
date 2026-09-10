import { describe, expect, test } from "bun:test"
import {
  isGeneratedOrSchemaFile,
  isDispatcherOrStateMachine,
  calculateMaxNestingDepth,
  estimateCyclomaticComplexity,
  scanArchitectureSlop,
} from "../../src/ocx/antislop/architecture"

describe("Architecture Complexity Guard", () => {
  test("generated and schema files are exempt from architecture scanning", () => {
    expect(isGeneratedOrSchemaFile("packages/client/src/generated/index.ts")).toBe(true)
    expect(isGeneratedOrSchemaFile("packages/schema/src/session.ts")).toBe(true)
    expect(isGeneratedOrSchemaFile("src/types.ts")).toBe(true)
    expect(isGeneratedOrSchemaFile("src/features/auth/service.ts")).toBe(false)

    const complexGenerated = "const x = 1;\n".repeat(1000)
    const findings = scanArchitectureSlop(complexGenerated, "packages/client/src/generated/api.ts")
    expect(findings.length).toBe(0)
  })

  test("switch dispatchers and state machines are exempted from raw cyclomatic penalties", () => {
    const switchCode = `
      function dispatch(action: Action) {
        switch (action.type) {
          case "A": return 1
          case "B": return 2
          case "C": return 3
          case "D": return 4
          case "E": return 5
          default: return 0
        }
      }
    `
    expect(isDispatcherOrStateMachine(switchCode)).toBe(true)
    const complexity = estimateCyclomaticComplexity(switchCode)
    expect(complexity).toBeLessThanOrEqual(5)
  })

  test("deep nesting is detected accurately", () => {
    const shallowCode = `
      function f() {
        if (true) {
          return 1
        }
      }
    `
    expect(calculateMaxNestingDepth(shallowCode)).toBeLessThan(5)

    const deepCode = "{\n".repeat(15) + "return 1\n" + "}\n".repeat(15)
    expect(calculateMaxNestingDepth(deepCode)).toBeGreaterThan(12)

    const findings = scanArchitectureSlop(deepCode, "src/deep.ts")
    const deepFinding = findings.find((f) => f.rule === "A-deeply-nested-control-flow")
    expect(deepFinding).toBeDefined()
    expect(deepFinding?.severity).toBe("blocker")
  })

  test("excessive function parameters trigger options interface warning", () => {
    const code = `
      function createUser(name: string, email: string, age: number, role: string, department: string, manager: string) {
        return { name }
      }
    `
    const findings = scanArchitectureSlop(code, "src/user.ts")
    const paramFinding = findings.find((f) => f.rule === "A-parameter-count-high")
    expect(paramFinding).toBeDefined()
    expect(paramFinding?.fix).toContain("options interface")
  })

  test("file length thresholds distinguish warning vs blocker", () => {
    const line = "const a = 1\n"
    const warnCode = line.repeat(450)
    const warnFindings = scanArchitectureSlop(warnCode, "src/warn.ts")
    const warnItem = warnFindings.find((f) => f.rule === "A-file-length-high")
    expect(warnItem).toBeDefined()
    expect(warnItem?.severity).toBe("warning")

    const blockCode = line.repeat(850)
    const blockFindings = scanArchitectureSlop(blockCode, "src/block.ts")
    const blockItem = blockFindings.find((f) => f.rule === "A-file-length-excessive")
    expect(blockItem).toBeDefined()
    expect(blockItem?.severity).toBe("blocker")
  })
})
