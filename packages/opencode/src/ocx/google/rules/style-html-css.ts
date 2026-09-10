import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const HTML_CSS_STYLE_RULES: readonly GoogleRule[] = [
  {
    id: "google-html-doctype",
    name: "html5-doctype",
    category: "style",
    languages: ["html"],
    severity: "error",
    description: "HTML files must declare <!DOCTYPE html> on the first line.",
    rationale: "Google HTML/CSS Style Guide requires HTML5 standard doctype.",
    citation: "Google Style Guides: htmlcssguide.html #Document_Type",
    fixable: true,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      if (context.lines.length > 0) {
        const firstLine = context.lines[0].trim()
        if (!firstLine.toLowerCase().startsWith("<!doctype html>")) {
          findings.push({
            ruleId: "google-html-doctype",
            category: "style",
            severity: "error",
            file: context.filePath,
            line: 1,
            column: 1,
            message: "Missing <!DOCTYPE html> doctype declaration on first line.",
            citation: "htmlcssguide.html #Document_Type",
            fixable: true,
            suggestion: "Add <!DOCTYPE html> to line 1.",
            snippet: firstLine,
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-html-no-inline-styles",
    name: "no-inline-styles",
    category: "style",
    languages: ["html"],
    severity: "warning",
    description: "Do not use inline styles (style=\"...\"); use external stylesheets or class selectors.",
    rationale: "Separates style from content and maintains clean maintainability.",
    citation: "Google Style Guides: htmlcssguide.html #Separation_of_Structure_from_Presentation",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const styleAttrRegex = /\bstyle\s*=\s*["'][^"']+["']/i
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = styleAttrRegex.exec(line)
        if (match) {
          findings.push({
            ruleId: "google-html-no-inline-styles",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: "Inline style attribute found. Use CSS classes in stylesheets.",
            citation: "htmlcssguide.html #Separation_of_Structure_from_Presentation",
            fixable: false,
            suggestion: "Extract style declarations into a stylesheet class.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-css-no-id-selector",
    name: "no-id-selectors",
    category: "style",
    languages: ["css"],
    severity: "warning",
    description: "Avoid using ID selectors (#element-id) for CSS styling.",
    rationale: "IDs have excessive specificity and prevent style reuse.",
    citation: "Google Style Guides: htmlcssguide.html #ID_Selectors",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const idSelectorRegex = /^#[a-zA-Z0-9_\-]+\s*\{/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i].trim()
        if (idSelectorRegex.test(line)) {
          findings.push({
            ruleId: "google-css-no-id-selector",
            category: "style",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: 1,
            message: "ID selector used for CSS styling. Use class selectors instead.",
            citation: "htmlcssguide.html #ID_Selectors",
            fixable: false,
            suggestion: "Change ID selector to a class selector (.class-name).",
            snippet: line,
          })
        }
      }
      return findings
    },
  },
]
