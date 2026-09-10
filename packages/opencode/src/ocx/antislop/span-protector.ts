export type ProtectedSpan = {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly reason: string
  readonly editable?: boolean
}

export type ProtectedSpanInput = {
  readonly text: string
  readonly reason: string
  readonly editable?: boolean
  readonly start?: number
}

export type ProtectInput = {
  readonly text: string
  readonly spans?: readonly ProtectedSpanInput[]
  readonly paths?: readonly string[]
  readonly commands?: readonly string[]
  readonly ids?: readonly string[]
  readonly markers?: readonly string[]
  readonly literals?: readonly string[]
  readonly quotedText?: readonly string[]
  readonly evidence?: readonly string[]
}

export type ProtectedSpanChange = {
  readonly id: string
  readonly before: string
  readonly after?: string
}

export type ProtectionResult = {
  readonly pass: boolean
  readonly changed: readonly ProtectedSpanChange[]
}

type Candidate = {
  readonly start: number
  readonly end: number
  readonly reason: string
  readonly editable?: boolean
}

const CODE_FENCE = /```[\s\S]*?```/g
const INLINE_CODE = /`[^`\n]+`/g
const FILE_LINE = /(?<![\w])(?:[A-Za-z]:[\\/]|\.?\.?\/|\/)?[\w@.+~%-]+(?:[\\/][\w@.+~%-]+)+:\d+(?:-\d+)?/g
const PATH = /(?<![\w])(?:[A-Za-z]:[\\/]|\.?\.?\/)?[\w@.+~%-]+(?:[\\/][\w@.+~%-]+)+(?:\.[A-Za-z0-9_-]+)?/g
const ID = /\b(?:ses|msg|prt|call|tool|req|run|wrk|usr|evt|task)_[A-Za-z0-9_-]+\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi
const MARKER = /===\s*[^=\n]+\s*===/g
const HEADER = /\bPHASE:\s+\S+\s+DEPTH:\s+\S+\s+STATE:\s+\S+/g
const LITERAL = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g
const CURLY_QUOTE = /“[^”\n]+”|‘[^’\n]+’/g
const QUALIFIED_NAME = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g
const SHELL_LINE = /^\s*(?:\$|>|(?:bun|npm|pnpm|yarn|git|cargo|go|python|pytest|node)\s+).+$/gm

export function protect(text: string, options?: Omit<ProtectInput, "text">): ProtectedSpan[]
export function protect(input: ProtectInput): ProtectedSpan[]
export function protect(inputOrText: ProtectInput | string, options: Omit<ProtectInput, "text"> = {}): ProtectedSpan[] {
  const input: ProtectInput = typeof inputOrText === "string" ? { ...options, text: inputOrText } : inputOrText
  const candidates: Candidate[] = []
  const add = (start: number, end: number, reason: string, editable?: boolean) => {
    if (start < 0 || end <= start || end > input.text.length) return
    candidates.push({ start, end, reason, ...(editable === true ? { editable: true } : {}) })
  }
  const addText = (value: string, reason: string, editable?: boolean) => {
    if (!value) return
    let offset = 0
    while (offset < input.text.length) {
      const start = input.text.indexOf(value, offset)
      if (start === -1) return
      add(start, start + value.length, reason, editable)
      offset = start + value.length
    }
  }
  const addMatches = (pattern: RegExp, reason: string) => {
    for (const match of input.text.matchAll(pattern)) {
      if (match.index !== undefined && match[0]) add(match.index, match.index + match[0].length, reason)
    }
  }

  for (const span of input.spans ?? []) {
    if (span.start !== undefined) {
      const end = span.start + span.text.length
      if (input.text.slice(span.start, end) === span.text) add(span.start, end, span.reason, span.editable)
      continue
    }
    addText(span.text, span.reason, span.editable)
  }
  for (const value of input.paths ?? []) addText(value, "path")
  for (const value of input.commands ?? []) addText(value, "command")
  for (const value of input.ids ?? []) addText(value, "id")
  for (const value of input.markers ?? []) addText(value, "marker")
  for (const value of input.literals ?? []) addText(value, "literal")
  for (const value of input.quotedText ?? []) addText(value, "quote")
  for (const value of input.evidence ?? []) addText(value, "evidence")

  addMatches(CODE_FENCE, "code")
  addMatches(INLINE_CODE, "literal")
  addMatches(FILE_LINE, "file_line")
  addMatches(PATH, "path")
  addMatches(ID, "id")
  addMatches(MARKER, "marker")
  addMatches(HEADER, "marker")
  addMatches(LITERAL, "literal")
  addMatches(CURLY_QUOTE, "quote")
  addMatches(QUALIFIED_NAME, "api")
  addMatches(SHELL_LINE, "command")

  const normalized = normalize(candidates)
  return normalized.map((candidate, index) => ({
    id: `p${index + 1}`,
    text: input.text.slice(candidate.start, candidate.end),
    start: candidate.start,
    end: candidate.end,
    reason: candidate.reason,
    ...(candidate.editable === true ? { editable: true } : {}),
  }))
}

export function mask(text: string, spans: readonly ProtectedSpan[]): string {
  return [...spans]
    .filter((span) => span.start >= 0 && span.end <= text.length)
    .sort((a, b) => b.start - a.start)
    .reduce((result, span) => result.slice(0, span.start) + `[PROTECTED:${span.id}]` + result.slice(span.end), text)
}

export function verify(_before: string, after: string, spans: readonly ProtectedSpan[]): ProtectionResult {
  const changed: ProtectedSpanChange[] = []
  let cursor = 0
  for (const span of [...spans].filter((item) => item.editable !== true).sort((a, b) => a.start - b.start)) {
    const index = after.indexOf(span.text, cursor)
    if (index === -1) {
      changed.push({
        id: span.id,
        before: span.text,
        after: after.slice(span.start, span.start + span.text.length),
      })
      continue
    }
    cursor = index + span.text.length
  }
  return { pass: changed.length === 0, changed }
}

export function overlaps(span: ProtectedSpan, start: number, end: number): boolean {
  return span.editable !== true && start < span.end && end > span.start
}

function normalize(candidates: readonly Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => a.start - b.start || b.end - a.end)
  const result: Candidate[] = []
  for (const candidate of sorted) {
    const prior = result.at(-1)
    if (!prior || candidate.start >= prior.end) {
      result.push(candidate)
      continue
    }
    if (candidate.end <= prior.end) continue
    result[result.length - 1] = {
      start: prior.start,
      end: candidate.end,
      reason: prior.reason,
      ...(prior.editable === true && candidate.editable === true ? { editable: true } : {}),
    }
  }
  return result
}

export * as SpanProtector from "./span-protector"
