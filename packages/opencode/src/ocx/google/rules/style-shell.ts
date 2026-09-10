import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const SHELL_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-shell-bash",
    name: "bash-only-shebang",
    category: "style",
    languages: ["shell"],
    severity: "warning",
    description: "Google Shell Style Guide mandates bash only (#!/bin/bash or #!/usr/bin/env bash).",
    rationale: "Ensures predictable behavior and access to bash built-in array/string handling.",
    citation: "Google Style Guides: shellguide.md #which-shell-to-use",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      if (context.lines.length > 0) {
        const firstLine = context.lines[0].trim()
        if (firstLine.startsWith("#!") && !firstLine.includes("bash")) {
          findings.push({
            ruleId: "google-shell-bash",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: 1,
            column: 1,
            message: "Google Shell Style Guide mandates bash; avoid #!/bin/sh or other shells.",
            citation: "shellguide.md #which-shell-to-use",
            fixable: true,
            suggestion: "Use #!/usr/bin/env bash or #!/bin/bash",
            snippet: firstLine,
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-shell-strict",
    name: "strict-error-handling",
    category: "style",
    languages: ["shell"],
    severity: "error",
    description: "Shell scripts must configure error trapping: set -euo pipefail.",
    rationale: "Failing to set strict error handling causes scripts to continue execution after failures.",
    citation: "Google Style Guides: shellguide.md",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      if (context.lines.length < 5) return findings
      const hasStrict = context.lines.some((line) => /set\s+-[a-zA-Z]*e/.test(line))
      if (!hasStrict) {
        findings.push({
          ruleId: "google-shell-strict",
          category: "style",
          severity: "error",
          file: context.filePath,
          line: 1,
          column: 1,
          message: "Missing 'set -euo pipefail' error trapping flag.",
          citation: "shellguide.md",
          fixable: false,
          suggestion: "Add 'set -euo pipefail' near the top of the script.",
        })
      }
      return findings
    },
  },
  {
    id: "google-shell-unquoted-vars",
    name: "quote-variable-expansions",
    category: "style",
    languages: ["shell"],
    severity: "warning",
    description: "Variables should be double-quoted to prevent globbing and word-splitting.",
    rationale: "Unquoted variable expansions cause bugs when filenames contain spaces or special characters.",
    citation: "Google Style Guides: shellguide.md #variable-expansion",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const unquotedVarRegex = /(^|[^"'\\])\$([a-zA-Z_][a-zA-Z0-9_]*)\b/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.trim().startsWith("#")) continue
        const match = unquotedVarRegex.exec(line)
        if (match && !line.includes("$((") && !line.includes("for ") && !line.includes("case ")) {
          findings.push({
            ruleId: "google-shell-unquoted-vars",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: `Unquoted variable '$${match[2]}' found. Quote expansions: \"\${${match[2]}}\".`,
            citation: "shellguide.md #variable-expansion",
            fixable: true,
            suggestion: `Wrap variable in double quotes: \"\${${match[2]}}\"`,
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
