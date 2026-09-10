import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const JAVASCRIPT_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-js-no-var",
    name: "no-var",
    category: "style",
    languages: ["javascript"],
    severity: "error",
    description: "Never use 'var'; declare variables with 'const' or 'let'.",
    rationale: "Google JavaScript Style Guide prohibits 'var' due to scoping ambiguity.",
    citation: "Google Style Guides: jsguide.html #var",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const varRegex = /\bvar\s+[a-zA-Z0-9_]+/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = varRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          findings.push({
            ruleId: "google-js-no-var",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "var declaration found. Use const or let.",
            citation: "jsguide.html #var",
            fixable: true,
            suggestion: "Replace 'var' with 'const'.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-js-strict-equality",
    name: "strict-equality",
    category: "style",
    languages: ["javascript", "typescript"],
    severity: "warning",
    description: "Always use strict equality (=== and !==) instead of loose equality (== and !=).",
    rationale: "Google style requires strict equality to prevent implicit type coercions.",
    citation: "Google Style Guides: jsguide.html #equality",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const looseEqRegex = /([^!=<>]|^)\s*(==|!=)\s*([^=]|$)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue
        const match = looseEqRegex.exec(line)
        if (match) {
          const operator = match[2]
          findings.push({
            ruleId: "google-js-strict-equality",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + match[1].length + 1,
            message: `Loose equality operator '${operator}' found. Use '${operator}=' instead.`,
            citation: "jsguide.html #equality",
            fixable: true,
            suggestion: `Replace '${operator}' with '${operator}='`,
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-js-throw-error",
    name: "throw-error-instance",
    category: "style",
    languages: ["javascript", "typescript"],
    severity: "error",
    description: "Always throw an Error instance, never throw string literals or primitive types.",
    rationale: "Throwing non-Error objects loses call stack traces and breaks standard error handling.",
    citation: "Google Style Guides: jsguide.html #exceptions",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const throwLiteralRegex = /\bthrow\s+(['"`0-9]|true|false)\b/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = throwLiteralRegex.exec(line)
        if (match && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-js-throw-error",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Throwing literals is prohibited; throw a new Error instance.",
            citation: "jsguide.html #exceptions",
            fixable: false,
            suggestion: "throw new Error(...) instead of literal.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-js-no-eval",
    name: "no-eval",
    category: "style",
    languages: ["javascript", "typescript"],
    severity: "error",
    description: "Never use eval() or Function constructor for dynamic execution.",
    rationale: "Eval introduces security vulnerabilities, disables V8 optimizations, and creates scoping leaks.",
    citation: "Google Style Guides: jsguide.html #eval",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const evalRegex = /\beval\s*\(/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = evalRegex.exec(line)
        if (match && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-js-no-eval",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "eval() is strictly prohibited in Google JavaScript.",
            citation: "jsguide.html #eval",
            fixable: false,
            suggestion: "Parse JSON safely with JSON.parse or use explicit logic.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
