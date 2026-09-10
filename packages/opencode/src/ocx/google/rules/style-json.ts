import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const JSON_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-json-syntax",
    name: "valid-json-syntax",
    category: "style",
    languages: ["json"],
    severity: "error",
    description: "JSON files must be strictly valid JSON.",
    rationale: "Invalid JSON causes parser failures in build tools and configurations.",
    citation: "Google Style Guides: jsoncstyleguide.html",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      try {
        JSON.parse(context.content)
      } catch (err) {
        findings.push({
          ruleId: "google-json-syntax",
          category: "style",
          severity: "error",
          file: context.filePath,
          line: 1,
          column: 1,
          message: `JSON syntax error: ${err instanceof Error ? err.message : String(err)}`,
          citation: "jsoncstyleguide.html",
          fixable: false,
        })
      }
      return findings
    },
  },
  {
    id: "google-json-indent",
    name: "two-space-indentation",
    category: "style",
    languages: ["json"],
    severity: "warning",
    description: "Google JSON Style requires 2-space indentation.",
    rationale: "Standardizes visual layout across all repository configs.",
    citation: "Google Style Guides: jsoncstyleguide.html",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.startsWith("\t")) {
          findings.push({
            ruleId: "google-json-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Tab indentation found in JSON; use 2 spaces.",
            citation: "jsoncstyleguide.html",
            fixable: true,
            suggestion: "Indent with 2 spaces.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
