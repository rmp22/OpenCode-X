import type { TestSuiteDefinition } from "./types"

export interface TestValidationResult {
  passed: boolean
  assertionCount: number
  trivialAssertions: number
  warnings: string[]
}

export function validateTestSuiteQuality(suite: TestSuiteDefinition): TestValidationResult {
  const warnings: string[] = []
  let assertionCount = 0
  let trivialAssertions = 0

  const lines = suite.fullSource.split("\n")
  for (const line of lines) {
    if (line.includes("expect(")) {
      assertionCount++
      if (line.includes("expect(true).toBe(true)") || line.includes("expect(1).toBe(1)")) {
        trivialAssertions++
        warnings.push("Trivial assertion detected: " + line.trim())
      }
    }
  }

  if (assertionCount === 0) {
    warnings.push("Test suite contains zero assertions")
  }

  return {
    passed: warnings.length === 0 && assertionCount > 0,
    assertionCount,
    trivialAssertions,
    warnings,
  }
}
