import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const PYTHON_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-py-indent",
    name: "two-space-indentation",
    category: "style",
    languages: ["python"],
    severity: "warning",
    description: "Google Python Style Guide requires 2 spaces for indentation.",
    rationale: "Google codebase uses 2 spaces per indentation level for Python, differing from standard PEP 8.",
    citation: "Google Style Guides: pyguide.md #indentation",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.startsWith("\t")) {
          findings.push({
            ruleId: "google-py-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Tab indentation found; Google Python style requires 2 spaces per level.",
            citation: "pyguide.md #indentation",
            fixable: true,
            suggestion: "Replace tabs with 2 spaces per indentation level.",
            snippet: line.trimEnd(),
          })
          continue
        }
        const spaces = line.match(/^ +/)?.[0]?.length ?? 0
        if (spaces > 0 && spaces % 2 !== 0) {
          findings.push({
            ruleId: "google-py-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Odd indentation width; Google Python requires 2 spaces per level.",
            citation: "pyguide.md #indentation",
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
    id: "google-py-line-length",
    name: "line-length-80",
    category: "style",
    languages: ["python"],
    severity: "warning",
    description: "Maximum line length in Google Python is 80 characters.",
    rationale: "Ensures code readability across terminal windows and diff review tools.",
    citation: "Google Style Guides: pyguide.md #line-length",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.length > 80) {
          findings.push({
            ruleId: "google-py-line-length",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 81,
            message: `Line exceeds 80 characters (${line.length} chars).`,
            citation: "pyguide.md #line-length",
            fixable: false,
            suggestion: "Wrap long statements using parentheses or break into multiple lines.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-py-no-wildcard-import",
    name: "no-wildcard-imports",
    category: "style",
    languages: ["python"],
    severity: "error",
    description: "Do not use wildcard imports (from module import *).",
    rationale: "Wildcard imports pollute the namespace and make symbol provenance opaque.",
    citation: "Google Style Guides: pyguide.md #imports",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const wildcardRegex = /^from\s+[a-zA-Z0-9_.]+\s+import\s+\*/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i].trim()
        if (wildcardRegex.test(line)) {
          findings.push({
            ruleId: "google-py-no-wildcard-import",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Wildcard import 'from ... import *' is prohibited in Google Python.",
            citation: "pyguide.md #imports",
            fixable: false,
            suggestion: "Import the module directly or name specific symbols explicitly.",
            snippet: context.lines[i].trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-py-no-mutable-defaults",
    name: "no-mutable-defaults",
    category: "style",
    languages: ["python"],
    severity: "error",
    description: "Do not use mutable objects as default values in function definitions.",
    rationale: "Default parameter values are evaluated once at module load; mutable defaults retain state across invocations.",
    citation: "Google Style Guides: pyguide.md #default-iterators-and-containers",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const mutableDefaultRegex = /def\s+[a-zA-Z0-9_]+\s*\([^)]*=\s*(\[\]|\{\}|set\(\))/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = mutableDefaultRegex.exec(line)
        if (match) {
          findings.push({
            ruleId: "google-py-no-mutable-defaults",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Mutable default argument found. Use None and initialize inside function.",
            citation: "pyguide.md #default-iterators-and-containers",
            fixable: false,
            suggestion: "Set default to None and assign inside function body: if param is None: param = []",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-py-no-bare-except",
    name: "no-bare-except",
    category: "style",
    languages: ["python"],
    severity: "error",
    description: "Never use bare 'except:'; catch specific exception types.",
    rationale: "A bare except catches SystemExit and KeyboardInterrupt, making programs un-killable and masking bugs.",
    citation: "Google Style Guides: pyguide.md #exceptions",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const bareExceptRegex = /^\s*except\s*:\s*$/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (bareExceptRegex.test(line)) {
          findings.push({
            ruleId: "google-py-no-bare-except",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: line.indexOf("except") + 1,
            message: "Bare 'except:' found. Catch specific exceptions instead.",
            citation: "pyguide.md #exceptions",
            fixable: false,
            suggestion: "Catch specific exception type, e.g. 'except (ValueError, KeyError) as err:'.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
