export type RefactorSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanRefactorSlop(content: string, filePath: string): readonly RefactorSlopFinding[] {
  const findings: RefactorSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.includes("rename") && trimmed.includes("//") && trimmed.includes("TODO")) {
      findings.push({
        rule: "R-unrelated-rename",
        severity: "warning",
        evidence: `rename with TODO comment at line ${i + 1}`,
        fix: "complete the rename or remove the TODO",
      })
    }

    if (trimmed.startsWith("//") && (trimmed.includes("format") || trimmed.includes("style") || trimmed.includes("cleanup"))) {
      findings.push({
        rule: "R-formatting-comment",
        severity: "warning",
        evidence: `formatting/cleanup comment at line ${i + 1}`,
        fix: "use a formatter tool instead of manual formatting comments",
      })
    }
  }

  return findings
}

export * as RefactorSlop from "./refactor"