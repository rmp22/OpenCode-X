import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const TYPESCRIPT_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-ts-indent",
    name: "two-space-indentation",
    category: "style",
    languages: ["typescript"],
    severity: "warning",
    description: "Use 2 spaces per indentation level; do not use tabs or 4 spaces.",
    rationale: "Google TypeScript Style Guide specifies 2-space indentation consistently.",
    citation: "Google Style Guides: tsguide.html #whitespace",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.startsWith("\t")) {
          findings.push({
            ruleId: "google-ts-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Tab indentation found; Google TypeScript requires 2 spaces.",
            citation: "tsguide.html #whitespace",
            fixable: true,
            suggestion: "Replace tabs with 2 spaces per indentation level.",
            snippet: line.trimEnd(),
          })
          continue
        }
        const leadingSpaces = line.match(/^ +/)?.[0]?.length ?? 0
        if (leadingSpaces > 0 && leadingSpaces % 2 !== 0) {
          findings.push({
            ruleId: "google-ts-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Odd indentation width found; Google TypeScript requires 2 spaces per level.",
            citation: "tsguide.html #whitespace",
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
    id: "google-ts-semicolon",
    name: "require-semicolon",
    category: "style",
    languages: ["typescript"],
    severity: "error",
    description: "Semicolons are required at the end of statements.",
    rationale: "Google TypeScript requires explicit semicolons to prevent ASI ambiguities.",
    citation: "Google Style Guides: tsguide.html #semicolons",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i].trim()
        if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue
        if (line.endsWith("{") || line.endsWith("}") || line.endsWith(":") || line.endsWith(",") || line.endsWith("=") || line.endsWith("|") || line.endsWith("&") || line.endsWith("(") || line.endsWith("[")) continue
        if (line.startsWith("if ") || line.startsWith("for ") || line.startsWith("while ") || line.startsWith("switch ")) continue
        if (line.startsWith("export interface ") || line.startsWith("interface ") || line.startsWith("export default ")) continue
        if (/^(const|let|return|throw|import|export const|export let|export type)\b/.test(line)) {
          if (!line.endsWith(";")) {
            findings.push({
              ruleId: "google-ts-semicolon",
              category: "style",
              severity: "error",
              file: context.filePath,
              line: i + 1,
              column: context.lines[i].length,
              message: "Missing semicolon at the end of statement.",
              citation: "tsguide.html #semicolons",
              fixable: true,
              suggestion: "Add semicolon at the end of statement.",
              snippet: context.lines[i],
            })
          }
        }
      }
      return findings
    },
  },
  {
    id: "google-ts-no-any",
    name: "no-explicit-any",
    category: "style",
    languages: ["typescript"],
    severity: "error",
    description: "Do not use 'any'; use 'unknown' or specific types.",
    rationale: "Google TypeScript mandates strict typing and disallows 'any' because it disables type checks.",
    citation: "Google Style Guides: tsguide.html #type-system",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const anyRegex = /(:\s*any\b|\bas\s+any\b|<any>)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = anyRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          findings.push({
            ruleId: "google-ts-no-any",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Explicit 'any' type is prohibited. Use 'unknown' or a specific type.",
            citation: "tsguide.html #type-system",
            fixable: false,
            suggestion: "Replace 'any' with 'unknown' and narrow with type guards.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-ts-no-non-null-assertion",
    name: "avoid-non-null-assertion",
    category: "style",
    languages: ["typescript"],
    severity: "warning",
    description: "Avoid non-null assertions (!) unless justified.",
    rationale: "Non-null assertions bypass compiler safety checks and may cause runtime TypeError.",
    citation: "Google Style Guides: tsguide.html #type-assertions",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const nonNullRegex = /\b[a-zA-Z0-9_]+!\.[a-zA-Z0-9_]+/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = nonNullRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          findings.push({
            ruleId: "google-ts-no-non-null-assertion",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Non-null assertion operator (!) used. Prefer optional chaining (?.) or an explicit check.",
            citation: "tsguide.html #type-assertions",
            fixable: false,
            suggestion: "Use optional chaining (?.) or assert non-nullity with an if guard.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-ts-no-var",
    name: "no-var-declaration",
    category: "style",
    languages: ["typescript"],
    severity: "error",
    description: "Never use 'var'; use 'const' or 'let'.",
    rationale: "Google TypeScript strictly bans 'var' due to function scoping hazards.",
    citation: "Google Style Guides: tsguide.html #variable-declarations",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const varRegex = /\bvar\s+[a-zA-Z0-9_]+/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = varRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          findings.push({
            ruleId: "google-ts-no-var",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "'var' is prohibited in Google TypeScript. Use 'const' or 'let'.",
            citation: "tsguide.html #variable-declarations",
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
    id: "google-ts-todo-owner",
    name: "todo-requires-owner",
    category: "style",
    languages: ["typescript", "javascript"],
    severity: "warning",
    description: "TODO comments must include an owner: // TODO(username): description.",
    rationale: "Google style requires all TODO comments to identify a responsible owner or bug.",
    citation: "Google Style Guides: tsguide.html #todo-comments",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const badTodoRegex = /\/\/\s*TODO(?!\s*\([a-zA-Z0-9_\-.]+\):)/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = badTodoRegex.exec(line)
        if (match && !line.includes("// TODO(")) {
          findings.push({
            ruleId: "google-ts-todo-owner",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "TODO comments must include an owner in parentheses: // TODO(username): description.",
            citation: "tsguide.html #todo-comments",
            fixable: true,
            suggestion: "Format as // TODO(owner): description",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-ts-named-exports",
    name: "prefer-named-exports",
    category: "style",
    languages: ["typescript"],
    severity: "warning",
    description: "Prefer named exports over default exports.",
    rationale: "Google TypeScript strongly favors named exports to ensure refactoring consistency.",
    citation: "Google Style Guides: tsguide.html #exports",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const defaultExportRegex = /export\s+default\s+/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = defaultExportRegex.exec(line)
        if (match && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-ts-named-exports",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Default export found; Google TypeScript recommends named exports.",
            citation: "tsguide.html #exports",
            fixable: false,
            suggestion: "Use named exports: export function Name() { ... }",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-ts-no-debugger",
    name: "no-debugger",
    category: "style",
    languages: ["typescript", "javascript"],
    severity: "error",
    description: "Do not commit debugger statements.",
    rationale: "Debugger statements stop program execution and must not be checked into repository.",
    citation: "Google Style Guides: tsguide.html",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (/\bdebugger\b;?/.test(line) && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-ts-no-debugger",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: line.indexOf("debugger") + 1,
            message: "debugger statement must be removed before commit.",
            citation: "tsguide.html",
            fixable: false,
            suggestion: "Remove debugger statement.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
