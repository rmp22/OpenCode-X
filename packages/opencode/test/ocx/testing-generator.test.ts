import { describe, expect, test } from "bun:test"
import { generateTestSuite } from "@/ocx/testing/generator"
import { validateTestSuiteQuality } from "@/ocx/testing/validator"

describe("Test Generation & Validation", () => {
  test("generates test suites for exported functions", () => {
    const suite = generateTestSuite("@/util/math", ["add", "multiply"])
    expect(suite.testCases.length).toBe(6)
    expect(suite.fullSource).toContain('import { add, multiply } from "@/util/math"')
  })

  test("validates test suite quality and detects trivial assertions", () => {
    const suite = generateTestSuite("@/util/math", ["add"])
    const quality = validateTestSuiteQuality(suite)
    expect(quality.passed).toBe(true)
    expect(quality.assertionCount).toBeGreaterThan(0)
    expect(quality.trivialAssertions).toBe(0)
  })
})
