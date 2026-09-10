export type TestSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanTestSlop(content: string, filePath: string): readonly TestSlopFinding[] {
  const findings: TestSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.includes("expect(") && (trimmed.includes("toBeDefined()") || trimmed.includes("toBeTruthy()") || trimmed.includes("toBeNull()") || trimmed.includes("toBeUndefined()") || trimmed.includes("not.toBeNull()"))) {
      findings.push({
        rule: "T-asserts-not-null",
        severity: "warning",
        evidence: `assertion only checks existence at line ${i + 1}`,
        fix: "assert the specific expected behavior, not just that something exists",
      })
    }

    if (trimmed.includes(".toMatchSnapshot()") || trimmed.includes("toMatchInlineSnapshot()")) {
      findings.push({
        rule: "T-snapshot-only",
        severity: "warning",
        evidence: `snapshot test at line ${i + 1} without meaningful assertions`,
        fix: "add assertions that verify the specific behavior being tested",
      })
    }

    if (trimmed.includes("describe(") && i + 1 < lines.length) {
      const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim().length > 0)
      if (nextNonEmpty && nextNonEmpty.trim().includes("it(") && !nextNonEmpty.includes("expect(")) {
        findings.push({
          rule: "T-test-without-assertions",
          severity: "blocker",
          evidence: `test case at line ${i + 1} has no assertions`,
          fix: "add assertions that verify the expected behavior",
        })
      }
    }

    if (trimmed.includes("skip") || trimmed.includes("only") || trimmed.includes("todo")) {
      if (trimmed.includes("it.skip") || trimmed.includes("test.skip") || trimmed.includes("xit") || trimmed.includes("xtest")) {
        findings.push({
          rule: "T-skipped-test",
          severity: "warning",
          evidence: `skipped test at line ${i + 1}`,
          fix: "either implement the test or remove the skip",
        })
      }
    }
  }

  return findings
}

export * as TestSlop from "./test-slop"