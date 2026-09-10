import type { MemoryEntry, MemoryTier } from "./types"

export class SemanticMemoryStore {
  private entries: MemoryEntry[] = []

  addEntry(entry: Omit<MemoryEntry, "timestamp">): MemoryEntry {
    const fullEntry: MemoryEntry = {
      ...entry,
      timestamp: Date.now(),
    }
    this.entries.push(fullEntry)
    return fullEntry
  }

  getEntries(tier?: MemoryTier): MemoryEntry[] {
    if (!tier) return [...this.entries]
    return this.entries.filter((e) => e.tier === tier)
  }

  moveToTier(id: string, newTier: MemoryTier): boolean {
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) return false
    entry.tier = newTier
    return true
  }

  clear(): void {
    this.entries = []
  }
}

export const defaultMemoryStore = new SemanticMemoryStore()
