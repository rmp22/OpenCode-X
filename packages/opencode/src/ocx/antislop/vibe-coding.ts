export type VibeCodingFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanVibeCoding(content: string, filePath: string): readonly VibeCodingFinding[] {
  const findings: VibeCodingFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.includes("edit") && !trimmed.includes("read") && i > 0) {
      const prevLine = lines[i - 1].trim()
      if (!prevLine.includes("read") && !prevLine.includes("inspect") && !prevLine.includes("search")) {
        findings.push({
          rule: "VC-edit-before-understanding",
          severity: "warning",
          evidence: `edit at line ${i + 1} without prior read/inspect/search`,
          fix: "understand the codebase before editing",
        })
      }
    }

    if (trimmed.includes("TODO") && trimmed.includes("implement") && trimmed.includes("later")) {
      findings.push({
        rule: "VC-placeholder-production",
        severity: "blocker",
        evidence: `placeholder TODO at line ${i + 1}`,
        fix: "implement the required behavior or remove the TODO",
      })
    }
  }

  return findings
}

export * as VibeCodingSlop from "./vibe-coding"