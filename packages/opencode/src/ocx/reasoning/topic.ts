const LABEL_PREFIX = /^(?:thought|thinking|reasoning|title|summary)\s*[:\-]\s*/i
const UNAVAILABLE_CONTEXT =
  /(?:\b(?:no|missing|unavailable|availability|unknown|absent|without)\b.{0,32}\b(?:request|prompt|context)\b|\b(?:request|prompt|context)\b.{0,32}\b(?:missing|unavailable|unknown|absent|not\s+(?:provided|given|included|available|supplied))\b)/i
const VAGUE_WORDS = new Set([
  "a",
  "an",
  "answer",
  "change",
  "check",
  "checking",
  "code",
  "context",
  "continue",
  "current",
  "file",
  "files",
  "inspect",
  "issue",
  "next",
  "output",
  "plan",
  "problem",
  "read",
  "reading",
  "request",
  "response",
  "review",
  "source",
  "step",
  "summary",
  "task",
  "thing",
  "thinking",
  "title",
  "update",
  "work",
  "working",
])

export function deriveTopic(text: string): string | undefined {
  const lines = text
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\*\*(?:title|thought|thinking|summary)\*\*\s*/i, "")
        .replace(/^[-*+]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^(?:verified|unverified|decision|plan|note|thinking)\s*:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0 && !UNAVAILABLE_CONTEXT.test(line) && !vague(line) && !LABEL_PREFIX.test(line))
  if (lines.length === 0) return undefined
  for (const candidate of lines) {
    if (candidate.split(" ").length > 12 || /[,;-]/.test(candidate)) continue
    return candidate.length > 60 ? `${candidate.slice(0, 57).trimEnd()}...` : candidate
  }
  const first = lines[0]
  if (!first) return undefined
  const clause = first.split(/(?:[.!?]| - )\s/)[0] ?? first
  return `${clause.split(" ").slice(0, 8).join(" ")}...`
}

function vague(value: string): boolean {
  const words = value.toLocaleLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) ?? []
  return words.length === 0 || words.every((word) => VAGUE_WORDS.has(word))
}

export * as ReasoningTopic from "./topic"
