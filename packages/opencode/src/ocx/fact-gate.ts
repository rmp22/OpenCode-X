export type FactFinding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s)"',;:\]]+/gi
const ARXIV_PATTERN = /\barxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/gi
const ARXIV_ID_PATTERN = /\barxiv\s*:\s*([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/gi
const URL_PATTERN = /https?:\/\/[^\s<>"'`\])}]+/gi

const REFERENCE_FINDINGS_MAX = 3

type Reference = {
  readonly value: string
  readonly position: number
  readonly kind: "doi" | "arxiv" | "url"
}

function clean(value: string): string {
  return value.replace(/[.)]+$/, "")
}

function references(reply: string): Reference[] {
  const out: Reference[] = []
  const seen = new Set<string>()
  const add = (pattern: RegExp, kind: Reference["kind"], normalize: (match: RegExpExecArray) => string) => {
    for (const match of reply.matchAll(pattern)) {
      const value = normalize(match)
      const key = `${kind}:${value.toLowerCase()}`
      if (!value || seen.has(key)) continue
      if (kind === "url" && (arxivID(value) || /^https?:\/\/doi\.org\//i.test(value))) continue
      seen.add(key)
      out.push({ value, position: match.index ?? 0, kind })
    }
  }

  add(ARXIV_PATTERN, "arxiv", (match) => match[1])
  add(ARXIV_ID_PATTERN, "arxiv", (match) => match[1])
  add(DOI_PATTERN, "doi", (match) => clean(match[0]))
  add(URL_PATTERN, "url", (match) => clean(match[0]))
  return out.sort((a, b) => a.position - b.position)
}

function arxivID(value: string): string | undefined {
  return /(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:)([0-9]{4}\.\d{4,5})/i.exec(value)?.[1]
}

function matches(reference: Reference, sources: readonly string[]): boolean {
  const value = reference.value.toLowerCase()
  return sources.some((source) => {
    const normalized = clean(source).toLowerCase()
    if (reference.kind === "arxiv") return arxivID(normalized) === value
    if (reference.kind === "doi") return normalized === `doi:${value}` || normalized.includes(value)
    return normalized === value
  })
}

export function referenceFindings(reply: string, sourceEvidence: readonly string[] | boolean): FactFinding[] {
  if (!reply || sourceEvidence === true) return []
  const sources = sourceEvidence === false ? [] : sourceEvidence
  return references(reply)
    .filter((reference) => !matches(reference, sources))
    .slice(0, REFERENCE_FINDINGS_MAX)
    .map((reference) => ({
      id: "F1-unverified-reference",
      message:
        sources.length === 0
          ? `reply cites "${reference.value}" but this turn gathered no sources; verify the reference resolves or remove it`
          : `reply cites "${reference.value}" but no opened source matches it; verify the reference or remove it`,
      span: reference.value,
    }))
}

export * as FactGate from "./fact-gate"
