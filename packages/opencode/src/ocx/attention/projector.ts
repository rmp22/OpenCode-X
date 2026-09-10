import {
  type AttentionMask,
  type AttentionSegment,
} from "./types"

export class MaskProjector {
  static projectContext(mask: AttentionMask): string {
    const parts: string[] = []

    if (mask.mode === "global") {
      for (const seg of mask.attendedSegments) {
        parts.push(`=== CONTEXT SEGMENT [id="${seg.id}"] (${seg.name}) ===\n${seg.content}\n=== END SEGMENT [${seg.id}] ===`)
      }
      return parts.join("\n\n")
    }

    if (mask.mode === "focus") {
      for (const seg of mask.attendedSegments) {
        parts.push(`=== FOCUSED SEGMENT [id="${seg.id}"] (${seg.name}) ===\n${seg.content}\n=== END FOCUSED SEGMENT [${seg.id}] ===`)
      }
      for (const seg of mask.maskedSegments) {
        parts.push(`[STOWED SEGMENT: id="${seg.id}" | ${seg.summary} | Use <focus segments="${seg.id}"> to attend]`)
      }
      return parts.join("\n\n")
    }

    for (const seg of mask.maskedSegments) {
      parts.push(`[STOWED CONTEXT: id="${seg.id}" (${seg.name}) - ${seg.tokenCount} tokens]`)
    }
    return parts.join("\n")
  }

  static projectBlockTable(mask: AttentionMask, blockSize: number = 16): {
    readonly attendedBlockIndices: readonly number[]
    readonly totalBlocks: number
  } {
    const attendedIndices: number[] = []
    let currentBlock = 0

    const allSegments = [...mask.attendedSegments, ...mask.maskedSegments].sort((a, b) => a.id.localeCompare(b.id))
    const attendedSet = new Set(mask.attendedSegments.map((s) => s.id))

    for (const seg of allSegments) {
      const numBlocks = Math.ceil(seg.blockAlignedTokenCount / blockSize)
      if (attendedSet.has(seg.id)) {
        for (let b = 0; b < numBlocks; b++) {
          attendedIndices.push(currentBlock + b)
        }
      }
      currentBlock += numBlocks
    }

    return {
      attendedBlockIndices: attendedIndices,
      totalBlocks: currentBlock,
    }
  }
}
