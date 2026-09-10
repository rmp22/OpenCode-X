import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const ENGINEERING_PRACTICES_RULES: readonly GoogleRule[] = [
  {
    id: "google-eng-cl-description",
    name: "cl-description-format",
    category: "eng-practices",
    languages: ["all"],
    severity: "warning",
    description: "Changelist (CL) description must have a concise imperative title and detailed rationale.",
    rationale: "Google Engineering Practices require informative CL descriptions that explain why changes were made and how they were tested.",
    citation: "Google Engineering Practices: review/developer/cl-descriptions.html",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      if (!context.gitCommitMessage) return findings
      const lines = context.gitCommitMessage.trim().split("\n")
      const title = lines[0]?.trim() ?? ""
      if (title.length > 72) {
        findings.push({
          ruleId: "google-eng-cl-description",
          category: "eng-practices",
          severity: "warning",
          file: context.filePath,
          line: 1,
          column: 1,
          message: `CL title exceeds 72 characters (${title.length} chars). Keep the first line short and imperative.`,
          citation: "review/developer/cl-descriptions.html",
          fixable: false,
          suggestion: "Summarize change in <= 72 chars.",
          snippet: title,
        })
      }
      if (lines.length > 1 && lines[1].trim() !== "") {
        findings.push({
          ruleId: "google-eng-cl-description",
          category: "eng-practices",
          severity: "warning",
          file: context.filePath,
          line: 2,
          column: 1,
          message: "CL description must separate the first line title from the body with a blank line.",
          citation: "review/developer/cl-descriptions.html",
          fixable: false,
          suggestion: "Insert a blank line after the first line.",
          snippet: lines[1],
        })
      }
      return findings
    },
  },
  {
    id: "google-eng-cl-size",
    name: "small-atomic-changes",
    category: "eng-practices",
    languages: ["all"],
    severity: "warning",
    description: "Keep changes small and atomic (typically under 500 lines or 15 files).",
    rationale: "Small CLs are reviewed faster, have fewer bugs, and are easier to revert if issues arise.",
    citation: "Google Engineering Practices: review/developer/small-cls.html",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      if (context.changedLinesCount !== undefined && context.changedLinesCount > 500) {
        findings.push({
          ruleId: "google-eng-cl-size",
          category: "eng-practices",
          severity: "warning",
          file: context.filePath,
          line: 1,
          column: 1,
          message: `Change contains ${context.changedLinesCount} changed lines. Google recommends CLs under 500 lines.`,
          citation: "review/developer/small-cls.html",
          fixable: false,
          suggestion: "Decompose into smaller, self-contained milestone CLs.",
        })
      }
      if (context.changedFilesCount !== undefined && context.changedFilesCount > 15) {
        findings.push({
          ruleId: "google-eng-cl-size",
          category: "eng-practices",
          severity: "warning",
          file: context.filePath,
          line: 1,
          column: 1,
          message: `Change modifies ${context.changedFilesCount} files. Consider splitting into focused PRs.`,
          citation: "review/developer/small-cls.html",
          fixable: false,
          suggestion: "Group related changes into separate reviews.",
        })
      }
      return findings
    },
  },
  {
    id: "google-eng-commented-code",
    name: "no-commented-out-code",
    category: "eng-practices",
    languages: ["typescript", "javascript", "python", "java", "cpp", "go"],
    severity: "warning",
    description: "Do not leave commented-out code in repository; use version control history instead.",
    rationale: "Commented-out code creates clutter, rots quickly, and confuses future readers.",
    citation: "Google Engineering Practices: review/reviewer/looking-for.html",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const commentedCodeRegex = /^\s*(\/\/|#|\/\*)\s*(const|let|var|function|def|import|return|class|if\s*\()\s+[a-zA-Z0-9_]+/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = commentedCodeRegex.exec(line)
        if (match) {
          findings.push({
            ruleId: "google-eng-commented-code",
            category: "eng-practices",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Commented-out code detected. Delete dead code instead of commenting it out.",
            citation: "review/reviewer/looking-for.html",
            fixable: true,
            suggestion: "Remove the commented-out code block.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
