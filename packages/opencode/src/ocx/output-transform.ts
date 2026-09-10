export type TransformResult = {
  readonly text: string
  readonly changes: readonly string[]
}

const EMOJI_GLYPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu
const SERVICE_ENDING =
  /\s+(?:Hope this helps[^\n]*|Let me know if[^\n]*|Would you like me to[^\n]*|Feel free to[^\n]*)\s*$/i
const STANDALONE_APOLOGY =
  /((?:^|\n)|(?<=[.!?])\s+)((?:I'?m )?sorry\b[^.\n]*\.?|I apologize\b[^.\n]*\.?)/gi

// Broken-session signature: the whole reply opened with a fenced header like
// ```html / <PHASE>: X: DEPTH:d STATE:s / ```. Unwrap it and rebuild the line
// in canonical plain form so downstream parsing and the TUI see one format.
function unwrapHeader(text: string): { text: string; changes: string[] } {
  const fenced = text.match(/^```(?:html)?\s*\n([^]*?)\n?```\s*(\n|$)/)
  if (!fenced || !/(?:^|\n)\s*<?PHASE>?:/i.test(fenced[1])) return { text, changes: [] }
  const inner = fenced[1].trim()
  const depth = /DEPTH:\s*(concise|standard|comprehensive)/i.exec(inner)?.[1] ?? "standard"
  const state = /STATE:\s*(done|blocked|needs_input)/i.exec(inner)?.[1] ?? "done"
  let phase = /^<?PHASE>?:?\s*([^:\n]+)/i.exec(inner)?.[1]?.trim()
  if (!phase) return { text, changes: [] }
  phase = phase.replace(/\s+DEPTH:.*$/i, "")
  const header = `PHASE: ${phase} DEPTH:${depth} STATE:${state}`
  const rest = inner.split("\n").slice(1).join("\n").replace(/^\s+/, "")
  const out = [header, rest].filter(Boolean).join("\n\n")
  return { text: out + (fenced[2] || ""), changes: ["unfenced-and-normalized-header"] }
}

function stripServiceEnding(text: string): { text: string; changes: string[] } {
  let out = text
  const changes: string[] = []
  while (SERVICE_ENDING.test(out)) {
    out = out.replace(SERVICE_ENDING, "\n").trimEnd()
    changes.push("removed-service-ending")
  }
  return { text: out, changes }
}

function purgeEmoji(text: string): { text: string; changes: string[] } {
  const matches = text.match(EMOJI_GLYPH)
  if (!matches) return { text, changes: [] }
  return {
    text: text.replace(EMOJI_GLYPH, "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    changes: [`removed-${matches.length}-emoji`],
  }
}

function clampApologies(text: string): { text: string; changes: string[] } {
  let seen = false
  let count = 0
  const out = text.replace(STANDALONE_APOLOGY, (_full, lead: string, sentence: string) => {
    if (!seen) {
      seen = true
      return `${lead}${sentence}`
    }
    count++
    return ""
  })
  if (!count) return { text, changes: [] }
  return {
    text: out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    changes: [`clamped-${count}-apologies`],
  }
}

function collapseBlanks(text: string): { text: string; changes: string[] } {
  if (!/\n{3,}/.test(text)) return { text, changes: [] }
  return { text: text.replace(/\n{3,}/g, "\n\n"), changes: ["collapsed-blank-lines"] }
}

export function transformReply(input: string): TransformResult {
  let text = input
  const changes: string[] = []
  for (const step of [unwrapHeader, stripServiceEnding, purgeEmoji, clampApologies, collapseBlanks]) {
    const result = step(text)
    text = result.text
    changes.push(...result.changes)
  }
  return { text, changes }
}
