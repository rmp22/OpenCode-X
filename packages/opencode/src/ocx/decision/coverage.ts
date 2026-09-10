import { BlindMutationError, type SourceCoverageEntry } from "./types"

export class SourceCoverageTracker {
  private reads = new Map<string, SourceCoverageEntry>()

  recordRead(filePath: string, metadata?: { linesCount?: number; byteSize?: number }): void {
    const normalized = filePath.trim()
    this.reads.set(normalized, {
      filePath: normalized,
      readTimestamp: Date.now(),
      readLinesCount: metadata?.linesCount,
      readByteSize: metadata?.byteSize,
    })
  }

  hasRead(filePath: string): boolean {
    const normalized = filePath.trim()
    return this.reads.has(normalized)
  }

  assertCanMutate(filePath: string): void {
    const normalized = filePath.trim()
    if (!this.hasRead(normalized)) {
      throw new BlindMutationError(normalized)
    }
  }

  getEntries(): SourceCoverageEntry[] {
    return Array.from(this.reads.values())
  }

  clear(): void {
    this.reads.clear()
  }
}

export const defaultSourceCoverage = new SourceCoverageTracker()
