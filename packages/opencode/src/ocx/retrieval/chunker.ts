import type { RetrievalChunk } from "./types"

const DECLARATION_REGEX = /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([a-zA-Z0-9_$]+)/

export function chunkFileContent(filePath: string, content: string): RetrievalChunk[] {
  const lines = content.split("\n")
  const chunks: RetrievalChunk[] = []
  let currentChunkLines: string[] = []
  let currentSymbolName: string | undefined
  let chunkStartLine = 1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const match = line.match(DECLARATION_REGEX)

    if (match && currentChunkLines.length > 0) {
      chunks.push({
        id: `${filePath}:${chunkStartLine}-${lineNum - 1}`,
        filePath,
        symbolName: currentSymbolName,
        content: currentChunkLines.join("\n"),
        startLine: chunkStartLine,
        endLine: lineNum - 1,
      })
      currentChunkLines = []
      chunkStartLine = lineNum
      currentSymbolName = match[1]
    } else if (match && currentChunkLines.length === 0) {
      currentSymbolName = match[1]
    }

    currentChunkLines.push(line)
  }

  if (currentChunkLines.length > 0) {
    chunks.push({
      id: `${filePath}:${chunkStartLine}-${lines.length}`,
      filePath,
      symbolName: currentSymbolName,
      content: currentChunkLines.join("\n"),
      startLine: chunkStartLine,
      endLine: lines.length,
    })
  }

  return chunks
}
