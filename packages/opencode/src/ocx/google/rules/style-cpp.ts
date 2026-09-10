import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const CPP_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-cpp-indent",
    name: "two-space-indentation",
    category: "style",
    languages: ["cpp"],
    severity: "warning",
    description: "Google C++ Style Guide mandates 2-space indentation.",
    rationale: "Uniform 2-space indentation without tabs across all C++ headers and source files.",
    citation: "Google Style Guides: cppguide.html #Spaces_vs._Tabs",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (line.startsWith("\t")) {
          findings.push({
            ruleId: "google-cpp-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Tab character found; Google C++ requires 2 spaces.",
            citation: "cppguide.html #Spaces_vs._Tabs",
            fixable: true,
            suggestion: "Replace tabs with 2 spaces per indentation level.",
            snippet: line.trimEnd(),
          })
          continue
        }
        const spaces = line.match(/^ +/)?.[0]?.length ?? 0
        if (spaces > 0 && spaces % 2 !== 0) {
          findings.push({
            ruleId: "google-cpp-indent",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "Odd indentation width; Google C++ requires 2 spaces per level.",
            citation: "cppguide.html #Spaces_vs._Tabs",
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
    id: "google-cpp-no-using-namespace-std",
    name: "no-using-namespace-std",
    category: "style",
    languages: ["cpp"],
    severity: "error",
    description: "Do not use 'using namespace std;' in header files or source files.",
    rationale: "Pollutes the global namespace and causes name collisions across libraries.",
    citation: "Google Style Guides: cppguide.html #Namespaces",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const usingStdRegex = /^\s*using\s+namespace\s+std\s*;/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (usingStdRegex.test(line)) {
          findings.push({
            ruleId: "google-cpp-no-using-namespace-std",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: i + 1,
            column: line.indexOf("using") + 1,
            message: "'using namespace std;' is prohibited in Google C++.",
            citation: "cppguide.html #Namespaces",
            fixable: false,
            suggestion: "Use explicit std:: qualification (e.g. std::string, std::vector).",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-cpp-nullptr",
    name: "use-nullptr",
    category: "style",
    languages: ["cpp"],
    severity: "warning",
    description: "Use 'nullptr' instead of 'NULL' or '0' for pointers in modern C++.",
    rationale: "nullptr is strongly typed and eliminates overload resolution ambiguities.",
    citation: "Google Style Guides: cppguide.html #0_and_nullptr/NULL",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const nullRegex = /\bNULL\b/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = nullRegex.exec(line)
        if (match && !line.trim().startsWith("//")) {
          findings.push({
            ruleId: "google-cpp-nullptr",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "NULL used for pointer comparison; use nullptr.",
            citation: "cppguide.html #0_and_nullptr/NULL",
            fixable: true,
            suggestion: "Replace NULL with nullptr.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
]
