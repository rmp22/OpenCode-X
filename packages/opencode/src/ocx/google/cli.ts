import * as fs from "node:fs/promises"
import * as path from "node:path"
import { scanDirectory, scanFile, scanText } from "./scanner"
import { fixContent } from "./fixer"
import { formatJson, formatMarkdown, formatTerminal } from "./reporter"
import { GOOGLE_PRACTICE_CATALOG } from "./catalog"
import type { RuleCategory, ScanOptions, ScanResult, SeverityLevel } from "./types"

function printHelp() {
  process.stdout.write(`
Google Developer Practices Enforcer

Usage:
  google-enforce [options] [paths...]

Options:
  -f, --format <format>     Output format: terminal | json | markdown (default: terminal)
  -s, --severity <level>    Minimum severity: error | warning | info (default: info)
  -c, --category <cat>      Filter categories: style, eng-practices, testing, api-design, architecture, security, documentation
      --fix                 Automatically fix remediable style violations
      --catalog             Print full Google Developer Practice catalog
  -h, --help                Show this help message

Examples:
  google-enforce src/
  google-enforce --format json packages/opencode/src
  google-enforce --fix src/index.ts
`)
}

function printCatalog() {
  process.stdout.write("# Google Developer Practices Catalog\n\n")
  for (const entry of GOOGLE_PRACTICE_CATALOG) {
    process.stdout.write(`## ${entry.title} (${entry.category})\n`)
    process.stdout.write(`Source: ${entry.source} (${entry.sourceUrl ?? ""})\n`)
    process.stdout.write(`Summary: ${entry.summary}\n\n`)
    process.stdout.write("Key Principles:\n")
    for (const p of entry.detailedPrinciples) {
      process.stdout.write(`  - ${p}\n`)
    }
    process.stdout.write("\n")
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2)
  if (args.includes("-h") || args.includes("--help")) {
    printHelp()
    return 0
  }

  if (args.includes("--catalog")) {
    printCatalog()
    return 0
  }

  let format: "terminal" | "json" | "markdown" = "terminal"
  let minSeverity: SeverityLevel = "info"
  const categories: RuleCategory[] = []
  let autoFix = false
  const targetPaths: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-f" || arg === "--format") {
      const next = args[++i]
      if (next === "json" || next === "markdown" || next === "terminal") {
        format = next
      }
    } else if (arg === "-s" || arg === "--severity") {
      const next = args[++i]
      if (next === "error" || next === "warning" || next === "info") {
        minSeverity = next
      }
    } else if (arg === "-c" || arg === "--category") {
      const next = args[++i]
      if (next) {
        categories.push(...(next.split(",") as RuleCategory[]))
      }
    } else if (arg === "--fix") {
      autoFix = true
    } else if (!arg.startsWith("-")) {
      targetPaths.push(arg)
    }
  }

  const options: ScanOptions = {
    minSeverity,
    categories: categories.length > 0 ? categories : undefined,
  }

  const targets = targetPaths.length > 0 ? targetPaths : ["."]
  let totalErrors = 0
  let totalWarnings = 0
  let totalInfos = 0
  let totalFiles = 0
  let totalLines = 0
  const allFindings = []

  for (const target of targets) {
    const resolved = path.resolve(target)
    try {
      const stat = await fs.stat(resolved)
      let result: ScanResult
      if (stat.isDirectory()) {
        result = await scanDirectory(resolved, options)
      } else {
        result = await scanFile(resolved, options)
      }

      if (autoFix && !stat.isDirectory()) {
        const original = await fs.readFile(resolved, "utf8")
        const fix = fixContent(resolved, original)
        if (fix.modified) {
          await fs.writeFile(resolved, fix.fixedContent, "utf8")
        }
      }

      totalErrors += result.errorCount
      totalWarnings += result.warningCount
      totalInfos += result.infoCount
      totalFiles += result.totalScannedFiles
      totalLines += result.totalScannedLines
      allFindings.push(...result.findings)
    } catch (err) {
      process.stderr.write(`Error scanning ${target}: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  const aggregatedResult: ScanResult = {
    findings: allFindings,
    totalScannedFiles: totalFiles,
    totalScannedLines: totalLines,
    durationMs: 0,
    errorCount: totalErrors,
    warningCount: totalWarnings,
    infoCount: totalInfos,
    passed: totalErrors === 0,
    summary: `${totalErrors} error(s), ${totalWarnings} warning(s), ${totalInfos} info finding(s) across ${totalFiles} file(s).`,
  }

  if (format === "json") {
    process.stdout.write(formatJson(aggregatedResult) + "\n")
  } else if (format === "markdown") {
    process.stdout.write(formatMarkdown(aggregatedResult) + "\n")
  } else {
    process.stdout.write(formatTerminal(aggregatedResult, process.stdout.isTTY) + "\n")
  }

  return aggregatedResult.passed ? 0 : 1
}

if (import.meta.main) {
  runCli(process.argv).then((code) => {
    process.exit(code)
  })
}
