export type SymbolKind = "function" | "class" | "interface" | "type" | "variable" | "method"

export interface ASTSymbolEntry {
  name: string
  kind: SymbolKind
  filePath: string
  startLine: number
  endLine: number
}

export interface RetrievalChunk {
  id: string
  filePath: string
  symbolName?: string
  content: string
  startLine: number
  endLine: number
  score?: number
}

export interface RetrievalQuery {
  query: string
  targetFiles?: string[]
  maxResults?: number
  contextFiles?: string[]
}

export interface RetrievalResult {
  query: string
  chunks: RetrievalChunk[]
  totalMatches: number
}
