export interface CheckMatchCandidate {
  readonly id: string
  readonly description?: string
}

export function normalizeCheckString(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[-_./:]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
}

export function matchCheckKey(reportedKey: string, candidates: readonly CheckMatchCandidate[]): CheckMatchCandidate | undefined {
  if (candidates.length === 0) return undefined
  const exact = candidates.find((c) => c.id === reportedKey || c.description === reportedKey)
  if (exact) return exact

  const normReported = normalizeCheckString(reportedKey)
  const normExact = candidates.find((c) => {
    return normalizeCheckString(c.id) === normReported || (c.description && normalizeCheckString(c.description) === normReported)
  })
  if (normExact) return normExact

  const reportedWords = new Set(normReported.split(" ").filter((w) => w.length > 2))
  let bestCandidate: CheckMatchCandidate | undefined
  let bestOverlap = 0

  for (const candidate of candidates) {
    const candidateWords = normalizeCheckString(`${candidate.id} ${candidate.description ?? ""}`).split(" ")
    let overlap = 0
    for (const w of candidateWords) {
      if (reportedWords.has(w)) overlap++
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestCandidate = candidate
    }
  }

  if (bestOverlap >= 2 || (reportedWords.size === 1 && bestOverlap === 1)) {
    return bestCandidate
  }

  return candidates[0]
}

export * as CheckMatcher from "./check-matcher"
