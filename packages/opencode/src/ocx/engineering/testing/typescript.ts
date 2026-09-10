export * as TestingKnowledge from "./typescript"

export type TestEntry = {
  readonly id: string
  readonly language: string
  readonly version: string
  readonly topic: string
  readonly rule: string
  readonly rationale: string
  readonly example: string
  readonly counterExample: string
  readonly severity: "info" | "warning" | "error"
  readonly verification: readonly string[]
  readonly lastReviewed: string
}

export const RULES: readonly TestEntry[] = [
  {
    id: "T1",
    language: "typescript",
    version: "1.0.0",
    topic: "test-naming",
    rule: "Test names should describe behavior, not implementation",
    rationale: "Behavior-driven names survive refactoring; implementation names break on every internal change",
    example: "'returns empty list when input is empty'",
    counterExample: "'test1' or 'edge-case-2'",
    severity: "warning",
    verification: ["test"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "T2",
    language: "typescript",
    version: "1.0.0",
    topic: "test-coverage",
    rule: "Tests must cover real behavior; assertions must detect the target defect",
    rationale: "Tests that cannot fail verify nothing; a passing test before a fix proves the test is ineffective",
    example: "assert(result === expected) after changing the logic under test",
    counterExample: "assert(true) or assert(result !== null) without checking the actual value",
    severity: "error",
    verification: ["test"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "T3",
    language: "typescript",
    version: "1.0.0",
    topic: "test-isolation",
    rule: "Avoid mocks as much as possible; test actual implementation",
    rationale: "Mocks test the mock, not the code; they miss real integration bugs",
    example: "Test the actual function with real inputs and real dependencies",
    counterExample: "Mocking every dependency so the test only verifies the mock setup",
    severity: "warning",
    verification: ["test"],
    lastReviewed: "2026-08-31",
  },
  {
    id: "T4",
    language: "typescript",
    version: "1.0.0",
    topic: "test-structure",
    rule: "Tests should run from package directories, not repo root",
    rationale: "Running from root causes guard violations and inconsistent test environments",
    example: "bun test from packages/opencode directory",
    counterExample: "bun test from repo root",
    severity: "info",
    verification: ["test"],
    lastReviewed: "2026-08-31",
  },
] as const