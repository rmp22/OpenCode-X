import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const JAVA_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-java-indent",
    name: "two-space-indentation",
    category: "style",
    languages: ["java"],
    severity: "warning",
    description: "Google Java Style Guide requires 2 spaces for block indentation.",
    rationale: "Maintains uniform visual structure across Google Java codebases.",
    citation: "Google Style Guides: javaguide.html #s4.2-block-indentation",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.startsWith("\t")) {
          findings.push({
            ruleId: "google-java-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Tab indentation found; Google Java requires 2 spaces.",
            citation: "javaguide.html #s4.2",
            fixable: true,
            suggestion: "Replace tabs with 2 spaces per indentation level.",
            snippet: line.trimEnd(),
          })
          continue
        }
        const spaces = line.match(/^ +/)?.[0]?.length ?? 0
        if (spaces > 0 && spaces % 2 !== 0) {
          findings.push({
            ruleId: "google-java-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Odd indentation width; Google Java requires 2 spaces per level.",
            citation: "javaguide.html #s4.2",
            fixable: true,
            suggestion: "Adjust indentation to an even multiple of 2 spaces.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-java-no-wildcard-import",
    name: "no-wildcard-import",
    category: "style",
    languages: ["java"],
    severity: "error",
    description: "Wildcard imports (static or non-static) are prohibited in Google Java.",
    rationale: "Explicit imports make class references unambiguous and prevent collision on upgrades.",
    citation: "Google Style Guides: javaguide.html #s3.3.1-wildcard-imports",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const wildcardRegex = /^import\s+(static\s+)?[a-zA-Z0-9_.]+\.\*;$/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i].trim()
        if (wildcardRegex.test(line)) {
          findings.push({
            ruleId: "google-java-no-wildcard-import",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Wildcard import found. Google Java prohibits wildcard imports.",
            citation: "javaguide.html #s3.3.1",
            fixable: false,
            suggestion: "Import individual classes explicitly.",
            snippet: context.lines[i].trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-java-line-length",
    name: "column-limit-100",
    category: "style",
    languages: ["java"],
    severity: "warning",
    description: "Google Java column limit is 100 characters.",
    rationale: "Prevents horizontal scrolling and simplifies side-by-side code review.",
    citation: "Google Style Guides: javaguide.html #s4.4-column-limit",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.trim().startsWith("package ") || line.trim().startsWith("import ")) continue
        if (line.length > 100) {
          findings.push({
            ruleId: "google-java-line-length",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 101,
            message: `Line exceeds 100 characters (${line.length} chars).`,
            citation: "javaguide.html #s4.4",
            fixable: false,
            suggestion: "Wrap statement onto next line.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-java-empty-catch",
    name: "empty-catch-explanation",
    category: "style",
    languages: ["java"],
    severity: "error",
    description: "Empty catch blocks must include an explanation or 'expected' in comment/variable name.",
    rationale: "Silently ignoring exceptions hides errors; Google style requires documenting intentional catches.",
    citation: "Google Style Guides: javaguide.html #s6.2-caught-exceptions",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const emptyCatchRegex = /catch\s*\([^)]+\)\s*\{\s*\}/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = emptyCatchRegex.exec(line)
        if (match && !line.includes("expected")) {
          findings.push({
            ruleId: "google-java-empty-catch",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Empty catch block without 'expected' explanation.",
            citation: "javaguide.html #s6.2",
            fixable: false,
            suggestion: "Add comment explaining why exception is safely ignored, or name exception 'expected'.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
