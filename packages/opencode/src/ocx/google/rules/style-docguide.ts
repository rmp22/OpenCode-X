import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const DOCGUIDE_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-doc-no-click-here",
    name: "descriptive-link-text",
    category: "documentation",
    languages: ["markdown"],
    severity: "warning",
    description: "Link text must be descriptive of the target; avoid 'click here' or 'here'.",
    rationale: "Google Developer Documentation Style Guide prohibits generic link phrases for accessibility and clarity.",
    citation: "Google Style Guides: docguide/best_practices.md #links",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const genericLinkRegex = /\[(click here|here|link|this link)\]\([^)]+\)/i
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = genericLinkRegex.exec(line)
        if (match) {
          findings.push({
            ruleId: "google-doc-no-click-here",
            category: "documentation",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: `Generic link text '${match[1]}' found. Use descriptive link text.`,
            citation: "docguide/best_practices.md #links",
            fixable: false,
            suggestion: "Rewrite link text to describe what the reader will find (e.g. [Authentication Guide](...)).",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-doc-code-language",
    name: "code-block-language-tag",
    category: "documentation",
    languages: ["markdown"],
    severity: "warning",
    description: "Markdown code blocks must declare an explicit language identifier.",
    rationale: "Enables syntax highlighting and prevents formatting ambiguity in documentation renders.",
    citation: "Google Style Guides: docguide/best_practices.md #code-blocks",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i].trim()
        if (line === "```") {
          findings.push({
            ruleId: "google-doc-code-language",
            category: "documentation",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Code block missing language identifier (e.g. ```typescript).",
            citation: "docguide/best_practices.md #code-blocks",
            fixable: false,
            suggestion: "Add language name after backticks (e.g. ```bash or ```typescript).",
            snippet: line,
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-doc-heading-levels",
    name: "sequential-heading-levels",
    category: "documentation",
    languages: ["markdown"],
    severity: "warning",
    description: "Markdown headings must not skip levels (e.g. H1 directly to H3).",
    rationale: "Maintains clear document outline hierarchy for readers and screen readers.",
    citation: "Google Style Guides: docguide/best_practices.md #headings",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      let lastLevel = 0
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i].trim()
        const headingMatch = line.match(/^(#{1,6})\s+/)
        if (headingMatch) {
          const level = headingMatch[1].length
          if (lastLevel > 0 && level > lastLevel + 1) {
            findings.push({
              ruleId: "google-doc-heading-levels",
              category: "documentation",
              severity: "warning",
              file: context.filePath,
              line: i + 1,
              column: 1,
              message: `Skipped heading level from H${lastLevel} to H${level}.`,
              citation: "docguide/best_practices.md #headings",
              fixable: false,
              suggestion: `Use H${lastLevel + 1} instead of H${level}.`,
              snippet: line,
            })
          }
          lastLevel = level
        }
      }
      return findings
    },
  },
]
