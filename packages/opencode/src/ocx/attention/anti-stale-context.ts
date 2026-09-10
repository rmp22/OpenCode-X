export type EpistemicStatus = "known" | "assumed" | "stale" | "invalidated"

export interface ContextFact {
  readonly id: string
  readonly filePath?: string
  readonly claim: string
  readonly status: EpistemicStatus
  readonly turnObserved: number
  readonly lastVerifiedTurn?: number
  readonly evidence?: string
}

export interface FileMutation {
  readonly filePath: string
  readonly turn: number
  readonly mutationType: "edit" | "write" | "delete"
}

export interface ContextFreshnessResult<T> {
  readonly fresh: readonly T[]
  readonly stale: readonly T[]
  readonly invalidatedIds: readonly string[]
}

export class AntiStaleContextTracker {
  private readonly facts = new Map<string, ContextFact>()
  private readonly mutations: FileMutation[] = []
  private readonly fileLastModifiedTurn = new Map<string, number>()

  recordMutation(mutation: FileMutation): void {
    this.mutations.push(mutation)
    const existingTurn = this.fileLastModifiedTurn.get(mutation.filePath) ?? -1
    if (mutation.turn > existingTurn) {
      this.fileLastModifiedTurn.set(mutation.filePath, mutation.turn)
    }
    this.invalidateForFile(mutation.filePath, mutation.turn)
  }

  recordFact(input: Omit<ContextFact, "status"> & { readonly status?: EpistemicStatus }): ContextFact {
    const defaultStatus: EpistemicStatus = input.status ?? (input.evidence ? "known" : "assumed")
    const fact: ContextFact = {
      ...input,
      status: defaultStatus,
    }
    this.facts.set(fact.id, fact)
    return fact
  }

  invalidateForFile(filePath: string, turn: number): readonly string[] {
    const invalidated: string[] = []
    for (const [id, fact] of this.facts.entries()) {
      if (fact.filePath === filePath && fact.turnObserved < turn && fact.status !== "invalidated") {
        this.facts.set(id, { ...fact, status: "invalidated" })
        invalidated.push(id)
      }
    }
    return invalidated
  }

  checkStaleness(factId: string, currentTurn: number, maxAgeTurns?: number): EpistemicStatus {
    const fact = this.facts.get(factId)
    if (!fact) return "invalidated"
    if (fact.status === "invalidated") return "invalidated"

    if (fact.filePath) {
      const lastMod = this.fileLastModifiedTurn.get(fact.filePath)
      if (lastMod !== undefined && lastMod > fact.turnObserved) {
        this.facts.set(factId, { ...fact, status: "invalidated" })
        return "invalidated"
      }
    }

    const effectiveAge = currentTurn - (fact.lastVerifiedTurn ?? fact.turnObserved)
    if (maxAgeTurns !== undefined && effectiveAge > maxAgeTurns) {
      this.facts.set(factId, { ...fact, status: "stale" })
      return "stale"
    }

    return fact.status
  }

  filterFreshItems<T extends { readonly id: string; readonly filePath?: string; readonly turnObserved?: number }>(
    items: readonly T[],
    currentTurn: number,
    maxAgeTurns?: number,
  ): ContextFreshnessResult<T> {
    const fresh: T[] = []
    const stale: T[] = []
    const invalidatedIds: string[] = []

    for (const item of items) {
      const fileModified = item.filePath ? this.fileLastModifiedTurn.get(item.filePath) : undefined
      const isOutdatedByMutation =
        fileModified !== undefined && item.turnObserved !== undefined && fileModified > item.turnObserved

      if (isOutdatedByMutation) {
        stale.push(item)
        invalidatedIds.push(item.id)
        continue
      }

      const isFactInvalid = this.facts.get(item.id)?.status === "invalidated"
      if (isFactInvalid) {
        stale.push(item)
        invalidatedIds.push(item.id)
        continue
      }

      const age = item.turnObserved !== undefined ? currentTurn - item.turnObserved : 0
      const isStaleByAge = maxAgeTurns !== undefined && age > maxAgeTurns

      if (isStaleByAge) {
        stale.push(item)
      } else {
        fresh.push(item)
      }
    }

    return { fresh, stale, invalidatedIds }
  }

  getFacts(filter?: { readonly status?: EpistemicStatus; readonly filePath?: string }): readonly ContextFact[] {
    const all = Array.from(this.facts.values())
    return all.filter((fact) => {
      if (filter?.status && fact.status !== filter.status) return false
      if (filter?.filePath && fact.filePath !== filter.filePath) return false
      return true
    })
  }

  clear(): void {
    this.facts.clear()
    this.mutations.length = 0
    this.fileLastModifiedTurn.clear()
  }
}
