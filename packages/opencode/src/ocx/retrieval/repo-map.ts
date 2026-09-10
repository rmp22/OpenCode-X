import { chunkFileContent } from "./chunker"
import { rankChunks } from "./ranking"
import type { ASTSymbolEntry, RetrievalChunk, RetrievalQuery, RetrievalResult } from "./types"

const IGNORE_PATTERNS = [
  /(?:^|\/)\.git\//,
  /(?:^|\/)node_modules\//,
  /(?:^|\/)dist\//,
  /(?:^|\/)build\//,
  /(?:^|\/)\.next\//,
]

export class RepositorySymbolMap {
  private fileChunks = new Map<string, RetrievalChunk[]>()
  private symbols = new Map<string, ASTSymbolEntry[]>()

  indexFile(filePath: string, content: string): void {
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.test(filePath)) return
    }

    const chunks = chunkFileContent(filePath, content)
    this.fileChunks.set(filePath, chunks)

    const fileSymbols: ASTSymbolEntry[] = []
    for (const chunk of chunks) {
      if (chunk.symbolName) {
        fileSymbols.push({
          name: chunk.symbolName,
          kind: "function",
          filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        })
      }
    }
    this.symbols.set(filePath, fileSymbols)
  }

  search(query: RetrievalQuery): RetrievalResult {
    let candidateChunks: RetrievalChunk[] = []

    if (query.targetFiles && query.targetFiles.length > 0) {
      for (const f of query.targetFiles) {
        const chunks = this.fileChunks.get(f)
        if (chunks) {
          candidateChunks.push(...chunks)
        }
      }
    } else {
      for (const chunks of this.fileChunks.values()) {
        candidateChunks.push(...chunks)
      }
    }

    return rankChunks(candidateChunks, query)
  }

  getSymbolsForFile(filePath: string): ASTSymbolEntry[] {
    return this.symbols.get(filePath) ?? []
  }

  clear(): void {
    this.fileChunks.clear()
    this.symbols.clear()
  }
}

export const defaultRepoMap = new RepositorySymbolMap()
