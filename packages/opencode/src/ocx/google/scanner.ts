import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { GoogleFinding, RuleContext, ScanOptions, ScanResult, SeverityLevel } from "./types"
import { ALL_GOOGLE_RULES, detectLanguage } from "./rules/index"

function meetsSeverity(level: SeverityLevel, minLevel?: SeverityLevel): boolean {
  if (!minLevel || minLevel === "info") return true
  if (minLevel === "warning") return level === "warning" || level === "error"
  return level === "error"
}

export function scanContext(context: RuleContext, options?: ScanOptions): readonly GoogleFinding[] {
  const rules = ALL_GOOGLE_RULES.filter((rule) => {
    if (!rule.languages.includes(context.language) && !rule.languages.includes("all")) {
      return false
    }
    if (options?.categories && !options.categories.includes(rule.category)) {
      return false
    }
    if (options?.includeRuleIds && !options.includeRuleIds.includes(rule.id)) {
      return false
    }
    if (options?.excludeRuleIds && options.excludeRuleIds.includes(rule.id)) {
      return false
    }
    if (!meetsSeverity(rule.severity, options?.minSeverity)) {
      return false
    }
    return true
  })

  const findings: GoogleFinding[] = []
  for (const rule of rules) {
    const result = rule.check(context)
    for (const finding of result) {
      if (meetsSeverity(finding.severity, options?.minSeverity)) {
        findings.push(finding)
        if (options?.maxErrors && findings.length >= options.maxErrors) {
          return findings
        }
      }
    }
  }
  return findings
}

export function scanText(filePath: string, content: string, options?: ScanOptions): ScanResult {
  const start = Date.now()
  const lines = content.split("\n")
  const language = detectLanguage(filePath)
  const context: RuleContext = {
    filePath,
    content,
    lines,
    language,
  }

  const findings = scanContext(context, options)
  const errorCount = findings.filter((f) => f.severity === "error").length
  const warningCount = findings.filter((f) => f.severity === "warning").length
  const infoCount = findings.filter((f) => f.severity === "info").length

  return {
    findings,
    totalScannedFiles: 1,
    totalScannedLines: lines.length,
    durationMs: Date.now() - start,
    errorCount,
    warningCount,
    infoCount,
    passed: errorCount === 0,
    summary: `${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info finding(s) across 1 file.`,
  }
}

export async function scanFile(filePath: string, options?: ScanOptions): Promise<ScanResult> {
  const content = await fs.readFile(filePath, "utf8")
  return scanText(filePath, content, options)
}

export async function scanDirectory(dirPath: string, options?: ScanOptions): Promise<ScanResult> {
  const start = Date.now()
  const allFindings: GoogleFinding[] = []
  let scannedFiles = 0
  let scannedLines = 0

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "dist" ||
          entry.name === "build" ||
          entry.name === "target"
        ) {
          continue
        }
        await walk(fullPath)
      } else if (entry.isFile()) {
        const lang = detectLanguage(fullPath)
        if (lang === "all" && !fullPath.endsWith(".txt")) continue
        try {
          const content = await fs.readFile(fullPath, "utf8")
          scannedFiles++
          scannedLines += content.split("\n").length
          const result = scanText(fullPath, content, options)
          allFindings.push(...result.findings)
        } catch {
        }
      }
    }
  }

  await walk(dirPath)

  const errorCount = allFindings.filter((f) => f.severity === "error").length
  const warningCount = allFindings.filter((f) => f.severity === "warning").length
  const infoCount = allFindings.filter((f) => f.severity === "info").length

  return {
    findings: allFindings,
    totalScannedFiles: scannedFiles,
    totalScannedLines: scannedLines,
    durationMs: Date.now() - start,
    errorCount,
    warningCount,
    infoCount,
    passed: errorCount === 0,
    summary: `${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info finding(s) across ${scannedFiles} file(s).`,
  }
}

export function scanDiff(diffText: string, options?: ScanOptions): ScanResult {
  const start = Date.now()
  const lines = diffText.split("\n")
  const findings: GoogleFinding[] = []
  let currentFile = "diff"
  let fileLines: string[] = []

  function flushFile() {
    if (fileLines.length > 0 && currentFile !== "diff") {
      const content = fileLines.join("\n")
      const subResult = scanText(currentFile, content, options)
      findings.push(...subResult.findings)
      fileLines = []
    }
  }

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      flushFile()
      currentFile = line.slice(6)
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      fileLines.push(line.slice(1))
    }
  }
  flushFile()

  const errorCount = findings.filter((f) => f.severity === "error").length
  const warningCount = findings.filter((f) => f.severity === "warning").length
  const infoCount = findings.filter((f) => f.severity === "info").length

  return {
    findings,
    totalScannedFiles: 1,
    totalScannedLines: lines.length,
    durationMs: Date.now() - start,
    errorCount,
    warningCount,
    infoCount,
    passed: errorCount === 0,
    summary: `Diff scan: ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info finding(s).`,
  }
}
