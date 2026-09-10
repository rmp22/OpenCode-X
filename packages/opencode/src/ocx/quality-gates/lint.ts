export * as LintGate from "./lint"

export type LintFinding = {
  readonly id: string
  readonly message: string
  readonly line: number
  readonly severity: "error" | "warning" | "info"
}

export function checkLint(path: string, content: string): readonly LintFinding[] {
  const findings: LintFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const trimmed = line.trim()

    if (trimmed.length > 120) {
      findings.push({
        id: "L1-line-too-long",
        message: `line exceeds 120 characters (${trimmed.length})`,
        line: lineNum,
        severity: "info",
      })
    }

    if (line !== line.trimEnd()) {
      findings.push({
        id: "L2-trailing-whitespace",
        message: "trailing whitespace",
        line: lineNum,
        severity: "info",
      })
    }

    if (i > 0 && trimmed === "" && lines[i - 1].trim() === "") {
      findings.push({
        id: "L3-consecutive-blank-lines",
        message: "consecutive blank lines",
        line: lineNum,
        severity: "info",
      })
    }

    const todoMatch = trimmed.match(/\/\/\s*TODO/i)
    if (todoMatch && !trimmed.match(/\/\/\s*TODO\s*\([^)]+\)/i)) {
      findings.push({
        id: "L4-todo-without-owner",
        message: "TODO should include an owner in parentheses",
        line: lineNum,
        severity: "info",
      })
    }

    if (trimmed.includes("console.log") && !path.includes(".test.") && !path.includes("spec.")) {
      findings.push({
        id: "L5-console-log",
        message: "console.log found in non-test code; use a logger instead",
        line: lineNum,
        severity: "warning",
      })
    }

    if (trimmed.includes("debugger")) {
      findings.push({
        id: "L6-debugger-statement",
        message: "debugger statement found; remove before committing",
        line: lineNum,
        severity: "error",
      })
    }
  }

  return findings
}

export * as Lint from "./lint"