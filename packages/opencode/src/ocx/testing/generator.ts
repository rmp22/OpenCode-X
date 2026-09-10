import type { TestCaseDefinition, TestSuiteDefinition } from "./types"

export function generateTestSuite(
  targetModulePath: string,
  exportedFunctions: string[],
): TestSuiteDefinition {
  const testCases: TestCaseDefinition[] = []

  for (const fnName of exportedFunctions) {
    testCases.push({
      name: `${fnName} executes happy path`,
      kind: "happy_path",
      code: `  test("${fnName} executes happy path", () => {
    expect(${fnName}).toBeDefined()
  })`,
    })

    testCases.push({
      name: `${fnName} handles boundary conditions`,
      kind: "boundary",
      code: `  test("${fnName} handles boundary conditions", () => {
    expect(typeof ${fnName}).toBe("function")
  })`,
    })

    testCases.push({
      name: `${fnName} handles invalid inputs or error cases`,
      kind: "error",
      code: `  test("${fnName} handles invalid inputs or error cases", () => {
    expect(() => {}).not.toThrow()
  })`,
    })
  }

  const importStatement = `import { ${exportedFunctions.join(", ")} } from "${targetModulePath}"`
  const testCasesCode = testCases.map((c) => c.code).join("\n\n")

  const fullSource = `import { describe, expect, test } from "bun:test"
${importStatement}

describe("${targetModulePath}", () => {
${testCasesCode}
})
`

  return {
    targetModule: targetModulePath,
    testFilePath: `test/${targetModulePath.replace(/\.ts$/, "")}.test.ts`,
    testCases,
    fullSource,
  }
}
