export interface TestCaseDefinition {
  name: string
  kind: "happy_path" | "boundary" | "error"
  code: string
}

export interface TestSuiteDefinition {
  targetModule: string
  testFilePath: string
  testCases: TestCaseDefinition[]
  fullSource: string
}

export interface TestRunSummary {
  total: number
  passed: number
  failed: number
  durationMs: number
  failureMessages: string[]
}

export interface MutationTestResult {
  mutant: string
  detected: boolean
  killedByTest?: string
}
