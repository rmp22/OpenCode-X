import type { RetrievalChunk, RetrievalQuery, RetrievalResult } from "./types"

export function scoreChunk(
  chunk: RetrievalChunk,
  tokens: string[],
  contextFiles: Set<string>,
): number {
  let score = 0
  const lowerContent = chunk.content.toLowerCase()
  const lowerPath = chunk.filePath.toLowerCase()

  for (const token of tokens) {
    if (lowerContent.includes(token)) {
      score += 1.0
      if (chunk.symbolName?.toLowerCase().includes(token)) {
        score += 2.0
      }
    }
    if (lowerPath.includes(token)) {
      score += 1.5
    }
  }

  if (contextFiles.has(chunk.filePath)) {
    score += 3.0
  }

  return score
}

export function rankChunks(chunks: RetrievalChunk[], query: RetrievalQuery): RetrievalResult {
  const tokens = query.query.toLowerCase().split(/\s+/).filter(Boolean)
  const contextFiles = new Set(query.contextFiles ?? [])

  const scored = chunks.map((chunk) => ({
    ...chunk,
    score: scoreChunk(chunk, tokens, contextFiles),
  }))

  const filtered = scored.filter((c) => (c.score ?? 0) > 0)
  filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const max = query.maxResults ?? 20
  const topChunks = filtered.slice(0, max)

  return {
    query: query.query,
    chunks: topChunks,
    totalMatches: filtered.length,
  }
}
