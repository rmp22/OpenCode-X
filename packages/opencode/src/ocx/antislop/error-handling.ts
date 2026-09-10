export type ErrorHandlingSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanErrorHandling(content: string, filePath: string): readonly ErrorHandlingSlopFinding[] {
  const findings: ErrorHandlingSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.match(/catch\s*\(\s*\{?\s*\}\s*\)?\s*\{/) || trimmed.match(/catch\s*\(\s*\)\s*\{/)) {
      findings.push({
        rule: "E-empty-catch",
        severity: "blocker",
        evidence: `empty catch block at line ${i + 1}`,
        fix: "handle the error or re-throw with context",
      })
    }

    if (trimmed.match(/catch\s*\(.*\)\s*\{\s*$/) && i + 1 < lines.length && lines[i + 1].trim() === "}") {
      findings.push({
        rule: "E-empty-catch",
        severity: "blocker",
        evidence: `empty catch block at line ${i + 1}`,
        fix: "handle the error or re-throw with context",
      })
    }

    if (trimmed.match(/catch\s*\(.*\)\s*\{/) && !trimmed.includes("throw") && !trimmed.includes("return") && !trimmed.includes("throw")) {
      const nextLines = lines.slice(i + 1, i + 4).map((l) => l.trim()).join(" ")
      if (!nextLines.includes("throw") && !nextLines.includes("return") && !nextLines.includes("log") && !nextLines.includes("report")) {
        findings.push({
          rule: "E-silent-swallow",
          severity: "blocker",
          evidence: `catch block at line ${i + 1} does not throw, return, or report the error`,
          fix: "propagate the error or handle it explicitly",
        })
      }
    }

    if (trimmed.match(/catch\s*\(.*\)\s*\{/) && (trimmed.includes("return null") || trimmed.includes("return undefined") || trimmed.includes("return {}"))) {
      findings.push({
        rule: "E-null-on-every-failure",
        severity: "warning",
        evidence: `catch block at line ${i + 1} returns null/undefined/{} on failure`,
        fix: "propagate the error with typed error information",
      })
    }
  }

  return findings
}

export * as ErrorHandlingSlop from "./error-handling"