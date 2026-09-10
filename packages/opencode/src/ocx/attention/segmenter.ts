import {
  alignToBlock,
  estimateTokens,
  type AttentionConfig,
  type AttentionSegment,
  type SegmentKind,
  DEFAULT_ATTENTION_CONFIG,
} from "./types"

export class ContextSegmenter {
  private readonly config: AttentionConfig

  constructor(config: Partial<AttentionConfig> = {}) {
    this.config = { ...DEFAULT_ATTENTION_CONFIG, ...config }
  }

  createSegment(input: {
    readonly id: string
    readonly name: string
    readonly kind: SegmentKind
    readonly content: string
    readonly summary?: string
    readonly metadata?: Record<string, unknown>
  }): readonly AttentionSegment[] {
    if (input.content.trim().length === 0) {
      return [
        {
          id: input.id,
          name: input.name,
          kind: input.kind,
          content: "<empty_context>",
          tokenCount: this.measure(input.content),
          summary: input.summary || `${input.name} (empty)`,
          blockAlignedTokenCount: alignToBlock(this.measure("<empty_context>"), this.config.blockSize),
          metadata: input.metadata,
        },
      ]
    }

    const tokens = this.measure(input.content)
    if (tokens <= this.config.targetChunkSize) {
      return [
        {
          id: input.id,
          name: input.name,
          kind: input.kind,
          content: input.content,
          tokenCount: tokens,
          summary: input.summary || `${input.name} (${tokens} tokens)`,
          blockAlignedTokenCount: alignToBlock(tokens, this.config.blockSize),
          metadata: input.metadata,
        },
      ]
    }

    return this.splitOversized(input)
  }

  private measure(text: string): number {
    return this.config.measureTokens ? this.config.measureTokens(text) : estimateTokens(text)
  }

  private hardCap(): number {
    return this.config.hardCapTokens ?? Math.ceil(this.config.targetChunkSize * 1.25)
  }

  private splitOversized(input: {
    readonly id: string
    readonly name: string
    readonly kind: SegmentKind
    readonly content: string
    readonly summary?: string
    readonly metadata?: Record<string, unknown>
  }): readonly AttentionSegment[] {
    const pieces = this.splitTopDown(input.content)
    const chunks = this.packPieces(pieces)

    return chunks.map((chunkText, index) => {
      const partId = `${input.id}:part_${index + 1}`
      const tokens = this.measure(chunkText)
      return {
        id: partId,
        name: `${input.name} (Part ${index + 1}/${chunks.length})`,
        kind: input.kind,
        content: chunkText,
        tokenCount: tokens,
        summary: input.summary
          ? `${input.summary} [part ${index + 1}/${chunks.length}]`
          : `${input.name} part ${index + 1}/${chunks.length} (${tokens} tokens)`,
        blockAlignedTokenCount: alignToBlock(tokens, this.config.blockSize),
        metadata: {
          ...input.metadata,
          parentSegmentId: input.id,
          partIndex: index + 1,
          totalParts: chunks.length,
        },
      }
    })
  }

  private splitTopDown(text: string): string[] {
    if (this.measure(text) <= this.hardCap()) return [text]

    for (const boundary of SPLIT_BOUNDARIES) {
      const units = splitKeepDelimiter(text, boundary)
      if (units.length <= 1) continue
      return units.flatMap((unit) => this.splitTopDown(unit))
    }

    return [text]
  }

  private packPieces(pieces: readonly string[]): string[] {
    const target = this.config.targetChunkSize
    const cap = this.hardCap()
    const chunks: string[] = []
    let current = ""
    let currentTokens = 0

    const flush = () => {
      if (current.length > 0) chunks.push(current)
      current = ""
      currentTokens = 0
    }

    for (const piece of pieces) {
      if (piece.trim().length === 0) {
        current += piece
        continue
      }
      const pieceTokens = this.measure(piece)
      if (currentTokens === 0) {
        current = piece
        currentTokens = pieceTokens
        continue
      }
      if (currentTokens + pieceTokens <= target) {
        current += piece
        currentTokens += pieceTokens
        continue
      }
      if (currentTokens + pieceTokens <= cap) {
        current += piece
        flush()
        continue
      }
      flush()
      current = piece
      currentTokens = pieceTokens
    }
    flush()
    return chunks.length > 0 ? chunks : [pieces.join("")].filter((c) => c.length > 0)
  }

  fromToolResult(toolName: string, callId: string, output: string): readonly AttentionSegment[] {
    let kind: SegmentKind = "tool_output"
    if (toolName === "read" || toolName === "write") kind = "file_content"
    else if (toolName === "edit" || toolName === "apply_patch") kind = "diff"
    else if (toolName === "grep" || toolName === "glob" || toolName === "readlines") kind = "search_result"
    else if (toolName === "bash" || toolName === "shell") kind = "command_log"

      const summary = `${toolName}:${callId} (${this.measure(output)} tokens)`

    return this.createSegment({
      id: `tool:${callId}`,
      name: `${toolName}:${callId}`,
      kind,
      content: output,
      summary,
      metadata: { toolName, callId },
    })
  }
}

const SPLIT_BOUNDARIES: readonly RegExp[] = [
  /(\n\s*\n\s*)/,
  /(\n)/,
  /([.!?]["'”’]?\s+)/,
  /([;:,]\s+)/,
  /(\s+)/,
]

function splitKeepDelimiter(text: string, boundary: RegExp): string[] {
  const raw = text.split(boundary)
  const units: string[] = []
  for (let i = 0; i < raw.length; i += 2) {
    const unit = (raw[i] ?? "") + (raw[i + 1] ?? "")
    if (unit.length > 0) units.push(unit)
  }
  return units.length > 0 ? units : [text]
}
