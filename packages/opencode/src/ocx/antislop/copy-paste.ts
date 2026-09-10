export type CopyPasteSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanCopyPaste(content: string, filePath: string): readonly CopyPasteSlopFinding[] {
  const findings: CopyPasteSlopFinding[] = []
  const lines = content.split("\n")

  const lineHashes = new Map<string, number[]>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.length < 20 || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue

    const hash = trimmed.replace(/\s+/g, " ").trim()
    const existing = lineHashes.get(hash) ?? []
    existing.push(i + 1)
    lineHashes.set(hash, existing)
  }

  for (const [hash, lineNumbers] of lineHashes) {
    if (lineNumbers.length >= 2) {
      findings.push({
        rule: "CP-duplicate-line",
        severity: "warning",
        evidence: `identical line at lines ${lineNumbers.join(", ")}`,
        fix: "extract the shared block into a helper function or reuse an existing path",
      })
    }
  }

  return findings
}

export * as CopyPasteSlop from "./copy-paste"