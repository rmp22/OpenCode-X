import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const ARCHITECTURE_RULES: readonly GoogleRule[] = [
  {
    id: "google-arch-deprecation-instructions",
    name: "deprecation-migration-path",
    category: "architecture",
    languages: ["typescript", "javascript", "java", "go", "python"],
    severity: "warning",
    description: "Deprecations must include migration guidance and replacement recommendations.",
    rationale: "Software Engineering at Google (Chapter 15) mandates clear paths and deadlines for deprecated APIs.",
    citation: "Software Engineering at Google: Chapter 15 #deprecation",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const deprecationRegex = /(@deprecated|\/\/\s*Deprecated:)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = deprecationRegex.exec(line)
        if (match) {
          const docBlock = context.lines.slice(i, Math.min(i + 5, context.lines.length)).join(" ")
          const hasGuidance = /(use\s+|replace\s+with|see\s+|refer\s+to)/i.test(docBlock)
          if (!hasGuidance) {
            findings.push({
              ruleId: "google-arch-deprecation-instructions",
              category: "architecture",
              severity: "warning",
              file: context.filePath,
              line: i + 1,
              column: match.index + 1,
              message: "Deprecation annotation lacks migration instructions or replacement API reference.",
              citation: "swe-book/html/ch15.html",
              fixable: false,
              suggestion: "Add explanation of what replacement to use and when removal is scheduled.",
              snippet: line.trimEnd(),
            })
          }
        }
      }
      return findings
    },
  },
]
