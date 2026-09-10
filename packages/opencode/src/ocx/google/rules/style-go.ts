import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const GO_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-go-context-first",
    name: "context-as-first-parameter",
    category: "style",
    languages: ["go"],
    severity: "warning",
    description: "context.Context must be the first parameter of a function.",
    rationale: "Google Go style mandates passing ctx as the first parameter for cancellation and tracing propagation.",
    citation: "Google Style Guides: go/best-practices.md #contexts",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const badContextParamRegex = /func\s+(\([^)]+\)\s+)?[a-zA-Z0-9_]+\s*\([^,)]+,\s*ctx\s+context\.Context/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = badContextParamRegex.exec(line)
        if (match && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-go-context-first",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "context.Context should be the first parameter in function signatures.",
            citation: "go/best-practices.md #contexts",
            fixable: false,
            suggestion: "Move 'ctx context.Context' to the first argument position.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-go-receiver-name",
    name: "idiomatic-receiver-name",
    category: "style",
    languages: ["go"],
    severity: "warning",
    description: "Do not use 'this' or 'self' as method receiver names; use short 1-2 letter names.",
    rationale: "Google Go Style dictates short, consistent abbreviations for receivers reflecting the type.",
    citation: "Google Style Guides: go/guide.md #receiver-names",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const selfReceiverRegex = /func\s*\(\s*(this|self)\s+\*?[a-zA-Z0-9_]+\s*\)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = selfReceiverRegex.exec(line)
        if (match && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-go-receiver-name",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: `Unidiomatic receiver name '${match[1]}'. Use a 1-2 letter abbreviation of the type name.`,
            citation: "go/guide.md #receiver-names",
            fixable: false,
            suggestion: "Use short 1-2 letter receiver name, e.g. (s *Server) or (c *Client).",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-go-no-panic",
    name: "no-panic-in-library",
    category: "style",
    languages: ["go"],
    severity: "error",
    description: "Do not use panic() for ordinary control flow or error reporting.",
    rationale: "Go library code must return errors to callers rather than panicking.",
    citation: "Google Style Guides: go/decisions.md #panics",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const panicRegex = /\bpanic\s*\(/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = panicRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !context.filePath.endsWith("_test.go")) {
          findings.push({
            ruleId: "google-go-no-panic",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "panic() should not be used in library code. Return error instead.",
            citation: "go/decisions.md #panics",
            fixable: false,
            suggestion: "Return an error object to the caller.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
