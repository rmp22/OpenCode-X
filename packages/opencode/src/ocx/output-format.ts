export type HeaderViolation = {
  readonly message: string
  readonly span: string
}

const HEADER = /^PHASE:\s+\S+\s+DEPTH:\s+(?:concise|standard|comprehensive)\s+STATE:\s+(?:done|blocked|needs_input)$/i

export function check(text: string): HeaderViolation | undefined {
  const line = text.split(/\r?\n/, 1)[0]?.trimEnd() ?? ""
  if (HEADER.test(line)) return undefined
  return {
    message: "final replies must start with PHASE, DEPTH, and STATE fields",
    span: line.slice(0, 120),
  }
}

export function normalize(text: string, phase = "deliver", depth = "comprehensive", state = "done"): string {
  const resolvedState = state === "blocked" ? "needs_input" : state
  if (check(text) === undefined) {
    if (/STATE:\s*blocked\b/i.test(text)) {
      return text.replace(/\bSTATE:\s*blocked\b/i, "STATE: needs_input")
    }
    return text
  }
  const trimmed = text.trim()
  return `PHASE: ${phase} DEPTH: ${depth} STATE: ${resolvedState}\n\n${trimmed}`
}

export type StandardVerdictInput = {
  readonly title: string
  readonly summary: string
  readonly completed: readonly { readonly name: string; readonly details?: string; readonly path?: string }[]
  readonly proposals: readonly { readonly name: string; readonly rationale?: string }[]
  readonly verification?: readonly string[]
}

export function formatStandardVerdict(input: StandardVerdictInput): string {
  const lines: string[] = [`# ${input.title}`, "", input.summary, ""]
  lines.push("## 1. Completed Implementation (DONE)")
  for (const item of input.completed) {
    const loc = item.path ? ` (${item.path})` : ""
    const det = item.details ? `: ${item.details}` : ""
    lines.push(`- **${item.name}**${loc}${det}`)
  }
  lines.push("", "## 2. Architectural Proposals & Roadmap (PROPOSALS)")
  for (const item of input.proposals) {
    const rat = item.rationale ? `: ${item.rationale}` : ""
    lines.push(`- **${item.name}**${rat}`)
  }
  if (input.verification && input.verification.length > 0) {
    lines.push("", "## 3. Verification Evidence")
    for (const v of input.verification) lines.push(`- ${v}`)
  }
  return lines.join("\n")
}

export * as OutputFormat from "./output-format"
