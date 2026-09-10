import { describe, expect, test } from "bun:test"
import { createScaffoldPlan } from "../../src/ocx/greenfield/scaffold"
import { scanMagicValue } from "../../src/ocx/antislop/magic-value"
import { scanArchitectureSlop, estimateCyclomaticComplexity } from "../../src/ocx/antislop/architecture"
import { isGenuineMissingJavaImport } from "../../src/ocx/verification/diagnostics"
import { validateTextClaims } from "../../src/ocx/turn/claim"

describe("Same-Model Codegen Quality Eval", () => {
  test("greenfield initialization produces complete compilable skeletons across 5 languages", () => {
    const presets = ["node-ts", "rust", "go", "python", "java"] as const
    for (const preset of presets) {
      const plan = createScaffoldPlan("eval-project", preset)
      expect(plan.steps.length).toBe(4)
      expect(plan.skeleton.files.length).toBeGreaterThanOrEqual(2)
      expect(plan.skeleton.entryPoint.length).toBeGreaterThan(0)
      expect(plan.skeleton.testRunner.length).toBeGreaterThan(0)
    }
  })

  test("constant extraction churn is avoided for domain-specific patterns", () => {
    const codeWithDomainLiterals = `
      const query = "SELECT id, name FROM users WHERE active = 1"
      const pattern = "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$"
      const color = "#3b82f6"
      const header = "content-type"
      const template = "Hello %s, welcome to %s"
    `
    const findings = scanMagicValue(codeWithDomainLiterals, "src/components/Form.tsx")
    const stringFindings = findings.filter((f) => f.rule === "MV-repeated-magic-string")
    expect(stringFindings.length).toBe(0)
  })

  test("architecture complexity evaluates dispatchers cleanly without false positives", () => {
    const cleanDispatcher = `
      function handleEvent(event: AppEvent) {
        switch (event.type) {
          case "INIT": return initialize()
          case "START": return startSession()
          case "PAUSE": return pauseSession()
          case "RESUME": return resumeSession()
          case "STOP": return stopSession()
          default: return undefined
        }
      }
    `
    const complexity = estimateCyclomaticComplexity(cleanDispatcher)
    expect(complexity).toBeLessThanOrEqual(5)

    const findings = scanArchitectureSlop(cleanDispatcher, "src/dispatcher.ts")
    const blockerFindings = findings.filter((f) => f.severity === "blocker")
    expect(blockerFindings.length).toBe(0)
  })

  test("language aware diagnostics prevent false-positive missing import claims in Java", () => {
    expect(isGenuineMissingJavaImport("String")).toBe(false)
    expect(isGenuineMissingJavaImport("Integer")).toBe(false)
    expect(isGenuineMissingJavaImport("System")).toBe(false)
    expect(isGenuineMissingJavaImport("Exception")).toBe(false)

    expect(isGenuineMissingJavaImport("org.apache.commons.lang3.StringUtils")).toBe(true)
  })

  test("verification claim guard rejects unverified assertions before claiming done", () => {
    const badTurn = "VERIFIED: Refactor complete and verified\nSTATE: done"
    const findings = validateTextClaims(badTurn)
    expect(findings.length).toBeGreaterThan(0)

    const goodTurn = "VERIFIED: Test suite passes with 15 passed in 80ms\nSTATE: done"
    const goodFindings = validateTextClaims(goodTurn)
    const blockers = goodFindings.filter((f) => f.severity === "blocker")
    expect(blockers.length).toBe(0)
  })
})
