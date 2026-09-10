export type CommentSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

const RESTATING_CODE = /^(?:\/\/\s*|\/\*\s*)(?:initialize|loop|check|return|set|get|create|update|delete|fetch|call|handle|process|validate|transform|map|filter|reduce|sort|find|findIndex|some|every|flatMap|flat)\b/i

const CHATTY_PATTERNS = [
  /\b(?:this function|this method|this class|this module|this file|this component)\b/i,
  /\b(?:we need to|we should|we must|let's|we'll)\b/i,
  /\b(?:the purpose of|the reason for|in order to|so that)\b/i,
]

export function scanComments(content: string, filePath: string): readonly CommentSlopFinding[] {
  const findings: CommentSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*")) continue

    if (RESTATING_CODE.test(trimmed)) {
      findings.push({
        rule: "C-restating-code",
        severity: "warning",
        evidence: `comment restates code at line ${i + 1}`,
        fix: "remove the comment and let the code speak for itself",
      })
    }

    for (const pattern of CHATTY_PATTERNS) {
      if (pattern.test(trimmed)) {
        findings.push({
          rule: "C-chatty-comment",
          severity: "warning",
          evidence: `chatty comment at line ${i + 1}`,
          fix: "remove unnecessary explanation; the code should be self-documenting",
        })
        break
      }
    }
  }

  return findings
}

export * as CommentSlop from "./comment"