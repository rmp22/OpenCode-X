import type { Citation, Claim } from "./types"

export function extractSpeculativePhrases(text: string): string[] {
  const found: string[] = []
  const matches = text.matchAll(/\b(?:i assume|assuming|i think|likely|probably|might be|could be|maybe|presumably)\b/gi)
  for (const match of matches) {
    found.push(match[0].toLowerCase())
  }
  return found
}

export function extractCitations(text: string): Citation[] {
  const citations: Citation[] = []
  const matches = text.matchAll(/(?:^|[\s("'`])((?:[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)(?::(\d+))?)/g)
  for (const match of matches) {
    const raw = match[1]
    const lineStr = match[2]
    const filePath = lineStr ? raw.slice(0, raw.lastIndexOf(":")) : raw
    const lineNumber = lineStr ? Number.parseInt(lineStr, 10) : undefined

    if (filePath.includes("/") || filePath.includes(".")) {
      citations.push({
        filePath,
        lineNumber,
        verified: false,
      })
    }
  }
  return citations
}

export function parseClaimsFromText(text: string): Claim[] {
  const lines = text.split("\n")
  const claims: Claim[] = []
  let claimIndex = 1

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const isExplicitVerified = /^VERIFIED:\s*/i.test(trimmed)
    const isExplicitUnverified = /^UNVERIFIED:\s*/i.test(trimmed)

    const speculative = extractSpeculativePhrases(trimmed)
    const citations = extractCitations(trimmed)

    if (
      isExplicitVerified ||
      isExplicitUnverified ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      speculative.length > 0 ||
      citations.length > 0
    ) {
      const cleanText = trimmed.replace(/^(?:VERIFIED:|UNVERIFIED:)\s*/i, "").replace(/^[-*]\s*/, "")

      claims.push({
        id: `claim-${claimIndex++}`,
        text: cleanText,
        state: isExplicitVerified ? "verified" : isExplicitUnverified ? "unverified" : "unverified",
        citations,
        speculativePhrases: speculative,
      })
    }
  }

  return claims
}
