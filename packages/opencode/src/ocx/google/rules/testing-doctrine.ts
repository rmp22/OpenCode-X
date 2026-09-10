import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes(".test.") ||
    filePath.includes(".spec.") ||
    filePath.includes("_test.") ||
    filePath.includes("/test/") ||
    filePath.includes("/tests/")
  )
}

export const TESTING_DOCTRINE_RULES: readonly GoogleRule[] = [
  {
    id: "google-test-no-logic",
    name: "no-logic-in-tests",
    category: "testing",
    languages: ["typescript", "javascript", "python", "java", "go", "cpp"],
    severity: "warning",
    description: "Avoid branching logic (if/else/switch) and loops (for/while) inside test functions.",
    rationale: "Tests with internal logic become complex, difficult to reason about, and may hide bugs in assertion paths.",
    citation: "Software Engineering at Google: Chapter 12 & Testing on the Toilet #don't-put-logic-in-tests",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      if (!isTestFile(context.filePath)) return []
      const findings: GoogleFinding[] = []
      const logicRegex = /^\s*(if\s*\(|for\s*\(|while\s*\(|switch\s*\(|for\s+[a-zA-Z0-9_]+\s+in\b)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = logicRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("#")) {
          findings.push({
            ruleId: "google-test-no-logic",
            category: "testing",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Control flow logic (loops/conditionals) detected inside test file. Keep tests linear.",
            citation: "swe-book/html/ch12.html",
            fixable: false,
            suggestion: "Unroll loop into explicit test cases or use parameterized/table-driven testing.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-test-no-sleep",
    name: "eliminate-sleep-in-tests",
    category: "testing",
    languages: ["typescript", "javascript", "python", "java", "go", "cpp"],
    severity: "error",
    description: "Never use sleep/setTimeout to wait for asynchronous operations in tests.",
    rationale: "Real clock sleeps cause test suite flakiness, slow down CI, and mask race conditions.",
    citation: "Software Engineering at Google: Chapter 11 & Testing on the Toilet",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      if (!isTestFile(context.filePath)) return []
      const findings: GoogleFinding[] = []
      const sleepRegex = /\b(setTimeout\s*\(|time\.Sleep\s*\(|Thread\.sleep\s*\(|time\.sleep\s*\(|sleep\s*\()/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = sleepRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("#")) {
          findings.push({
            ruleId: "google-test-no-sleep",
            category: "testing",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Hardcoded sleep detected in test. Use virtual clocks, signals, or event polling instead.",
            citation: "swe-book/html/ch11.html",
            fixable: false,
            suggestion: "Replace sleep with an explicit promise, signal wait, or virtual clock advance.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-test-behavior-naming",
    name: "test-behavior-naming",
    category: "testing",
    languages: ["typescript", "javascript", "python", "java", "go"],
    severity: "info",
    description: "Name tests after the observable behavior and expected outcome, not method names.",
    rationale: "Behavioral test names clearly identify what broke and why when a regression occurs.",
    citation: "Software Engineering at Google: Chapter 12 #name-tests-after-the-behavior-being-tested",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      if (!isTestFile(context.filePath)) return []
      const findings: GoogleFinding[] = []
      const badTestNameRegex = /(test|it)\s*\(\s*["'](test\d+|test[A-Z][a-zA-Z0-9]*|run|execute|check)["']/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = badTestNameRegex.exec(line)
        if (match) {
          findings.push({
            ruleId: "google-test-behavior-naming",
            category: "testing",
            severity: "info",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: `Vague test name '${match[2]}'. State the condition and expected outcome.`,
            citation: "swe-book/html/ch12.html",
            fixable: false,
            suggestion: "Rename test to describe behavior, e.g. 'returns 404 when user id is not found'.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
