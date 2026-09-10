import type { GoogleFinding, ScanResult, SeverityLevel } from "./types"

const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

function colorSeverity(severity: SeverityLevel, useColor: boolean): string {
  if (!useColor) return `[${severity.toUpperCase()}]`
  switch (severity) {
    case "error":
      return `${RED}${BOLD}[ERROR]${RESET}`
    case "warning":
      return `${YELLOW}${BOLD}[WARN]${RESET}`
    case "info":
      return `${CYAN}[INFO]${RESET}`
  }
}

export function formatTerminal(result: ScanResult, useColor = true): string {
  const lines: string[] = []
  lines.push(`${useColor ? BOLD : ""}=== Google Developer Practices Scan ===${useColor ? RESET : ""}`)
  lines.push("")

  if (result.findings.length === 0) {
    lines.push(`${useColor ? GREEN : ""}✓ No Google practice violations detected.${useColor ? RESET : ""}`)
    lines.push(`Scanned ${result.totalScannedFiles} file(s), ${result.totalScannedLines} line(s) in ${result.durationMs}ms.`)
    return lines.join("\n")
  }

  const byFile = new Map<string, GoogleFinding[]>()
  for (const finding of result.findings) {
    const list = byFile.get(finding.file) ?? []
    list.push(finding)
    byFile.set(finding.file, list)
  }

  for (const [file, findings] of byFile) {
    lines.push(`${useColor ? BOLD : ""}${file}${useColor ? RESET : ""}:`)
    for (const finding of findings) {
      const tag = colorSeverity(finding.severity, useColor)
      lines.push(`  ${tag} ${finding.line}:${finding.column} - ${finding.message} (${finding.ruleId})`)
      if (finding.snippet) {
        lines.push(`    Line: ${finding.snippet}`)
      }
      if (finding.suggestion) {
        lines.push(`    Suggestion: ${finding.suggestion}`)
      }
      if (finding.citation) {
        lines.push(`    Citation: ${finding.citation}`)
      }
      lines.push("")
    }
  }

  lines.push("--------------------------------------------------")
  const statusColor = result.passed ? (useColor ? GREEN : "") : (useColor ? RED : "")
  lines.push(`${statusColor}${result.passed ? "PASSED" : "FAILED"}${useColor ? RESET : ""}: ${result.summary}`)
  lines.push(`Duration: ${result.durationMs}ms`)
  return lines.join("\n")
}

export function formatJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2)
}

export function formatMarkdown(result: ScanResult): string {
  const lines: string[] = []
  lines.push("# Google Developer Practices Scan Report")
  lines.push("")
  lines.push(`**Status:** ${result.passed ? "✅ Passed" : "❌ Failed"}`)
  lines.push(`**Summary:** ${result.summary}`)
  lines.push(`**Files Scanned:** ${result.totalScannedFiles} | **Lines:** ${result.totalScannedLines} | **Duration:** ${result.durationMs}ms`)
  lines.push("")

  if (result.findings.length > 0) {
    lines.push("| File | Line | Severity | Rule | Message | Citation |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const f of result.findings) {
      lines.push(`| \`${f.file}\` | ${f.line}:${f.column} | ${f.severity} | \`${f.ruleId}\` | ${f.message} | ${f.citation ?? "-"} |`)
    }
  }

  return lines.join("\n")
}
