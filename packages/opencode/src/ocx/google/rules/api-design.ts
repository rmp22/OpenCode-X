import type { GoogleFinding, GoogleRule, RuleContext } from "../types"

export const API_DESIGN_RULES: readonly GoogleRule[] = [
  {
    id: "google-api-resource-verbs",
    name: "resource-oriented-urls",
    category: "api-design",
    languages: ["typescript", "javascript", "python", "go", "java"],
    severity: "warning",
    description: "Do not put HTTP action verbs in REST URLs (e.g. /getUser, /deleteItem); use HTTP methods.",
    rationale: "Google API Design Guide (AIP-121) requires resource-oriented paths with standard HTTP verbs.",
    citation: "Google API Improvement Proposals: https://google.aip.dev/121",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const verbInUrlRegex = /["'](\/(?:api\/)?[a-zA-Z0-9_-]+\/(?:get|fetch|delete|create|update|remove)[A-Z][a-zA-Z0-9_-]*)["']/
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        const match = verbInUrlRegex.exec(line)
        if (match && !line.trim().startsWith("//") && !line.trim().startsWith("#")) {
          findings.push({
            ruleId: "google-api-resource-verbs",
            category: "api-design",
            severity: "warning",
            file: context.filePath,
            line: i + 1,
            column: match.index + 1,
            message: `RPC-style verb in URL path '${match[1]}'. Use resource collections with standard HTTP methods.`,
            citation: "https://google.aip.dev/121",
            fixable: false,
            suggestion: "Refactor path to resource pattern: e.g. DELETE /v1/users/{id} instead of /deleteUser.",
            snippet: line.trimEnd(),
          })
        }
      }
      return findings
    },
  },
  {
    id: "google-api-pagination",
    name: "standard-pagination-fields",
    category: "api-design",
    languages: ["typescript", "javascript", "python", "go", "java"],
    severity: "info",
    description: "List API requests must use page_size and page_token, returning next_page_token.",
    rationale: "Google API Design Guide (AIP-158) standardizes pagination across all list operations.",
    citation: "Google API Improvement Proposals: https://google.aip.dev/158",
    fixable: false,
    check: (context: RuleContext): readonly GoogleFinding[] => {
      const findings: GoogleFinding[] = []
      const offsetPaginationRegex = /\b(offset|limit)\s*:\s*(number|int|string)/i
      for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i]
        if (/interface\s+List[a-zA-Z0-9]+Request|type\s+List[a-zA-Z0-9]+Request/.test(line)) {
          for (let j = i; j < Math.min(i + 10, context.lines.length); j++) {
            const innerLine = context.lines[j]
            const match = offsetPaginationRegex.exec(innerLine)
            if (match) {
              findings.push({
                ruleId: "google-api-pagination",
                category: "api-design",
                severity: "info",
                file: context.filePath,
                line: j + 1,
                column: match.index + 1,
                message: "Raw offset/limit pagination found. Google AIP-158 recommends page_size and page_token.",
                citation: "https://google.aip.dev/158",
                fixable: false,
                suggestion: "Use page_size: number and page_token: string for scalable pagination.",
                snippet: innerLine.trimEnd(),
              })
            }
          }
        }
      }
      return findings
    },
  },
]
