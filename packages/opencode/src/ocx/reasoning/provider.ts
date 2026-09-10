export type ProviderReasoningVisibility = "private" | "summary" | "public"

export type ProviderReasoningEvent = {
  kind: "start" | "delta" | "end"
  text?: string
  providerMetadata?: Record<string, unknown>
  visibility: ProviderReasoningVisibility
}

export type ProviderReasoningConfig = {
  native?: boolean
  interleavedField?: string
  extractTags?: string[]
}

const THINK_TAG_RE = /<(think|thinking)>([\s\S]*?)<\/\1>/gi

export function extractThinkTags(text: string, tags: string[]): { cleaned: string; extracted: string[] } {
  if (tags.length === 0) return { cleaned: text, extracted: [] }
  const pattern = new RegExp(`<(${tags.join("|")})>([\\s\\S]*?)<\\/\\1>`, "gi")
  const extracted: string[] = []
  let cleaned = text
  let match: RegExpExecArray | null
  const source = text
  const matches = [...source.matchAll(pattern)]
  for (const m of matches) {
    if (m[2]) extracted.push(m[2].trim())
  }
  cleaned = source.replace(pattern, "").trim()
  return { cleaned, extracted }
}

export function normalizeReasoningText(input: {
  text?: string
  providerMetadata?: Record<string, unknown>
  config: ProviderReasoningConfig
  visibility?: ProviderReasoningVisibility
}): ProviderReasoningEvent | undefined {
  const raw = input.text ?? ""
  if (!raw && !input.providerMetadata) return undefined
  const visibility = input.visibility ?? (raw ? "private" : "private")
  return {
    kind: "delta",
    text: raw,
    providerMetadata: input.providerMetadata,
    visibility,
  }
}

export function latestReasoningSegment(text: string): string | undefined {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const paragraph = paragraphs.at(-1)
  if (!paragraph) return undefined
  const line = paragraph
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1)
  if (!line) return undefined
  const cleaned = line
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s+)/, "")
    .replace(/^`{1,3}|`{1,3}$/g, "")
    .trim()
  return cleaned || undefined
}

export function shouldUseProviderSummary(providerMetadata: Record<string, unknown> | undefined): boolean {
  if (!providerMetadata) return false
  const summary = providerMetadata.summary ?? providerMetadata.reasoningSummary ?? providerMetadata.display_summary
  return typeof summary === "string" && summary.trim().length > 0
}

export function thinkingTagPattern(tags: string[]): RegExp | undefined {
  if (tags.length === 0) return undefined
  return new RegExp(`<(${tags.join("|")})>([\\s\\S]*?)<\\/\\1>`, "gi")
}

export function isHiddenReasoningMode(showReasoning: boolean): boolean {
  return !showReasoning
}

export * as ProviderReasoning from "./provider"
