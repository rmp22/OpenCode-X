import type {
  ExecutionBudget,
  ExecutionPacket,
  ExecutionResult,
  HierarchicalBudget,
  OwnerCheckpoint,
  OwnerHandoff,
  OwnerID,
  SourceObservation,
} from "./types"

export type ScopeFact = {
  readonly id: string
  readonly ownerId: OwnerID
  readonly category: "interface" | "architecture" | "constraint" | "dependency" | "test"
  readonly key: string
  readonly value: string
  readonly sourcePath?: string
  readonly sourceHash?: string
  readonly updatedAt: number
}

export type ScopeFamiliarity = {
  readonly ownerId: OwnerID
  readonly facts: readonly ScopeFact[]
  readonly keyInterfaces: readonly string[]
  readonly recentChanges: readonly string[]
  readonly tokenSavingsEstimate: number
}

export type MemoryMetrics = {
  readonly cacheHits: number
  readonly cacheMisses: number
  readonly tokensSavedEstimate: number
}

export class ScopeMemoryStore {
  private readonly facts = new Map<string, ScopeFact>()
  private cacheHits = 0
  private cacheMisses = 0

  addFact(fact: ScopeFact): void {
    this.facts.set(fact.id, fact)
  }

  getFactsForOwner(ownerId: OwnerID): readonly ScopeFact[] {
    const list: ScopeFact[] = []
    for (const fact of this.facts.values()) {
      if (fact.ownerId === ownerId) {
        list.push(fact)
      }
    }
    return list
  }

  getFamiliarity(ownerId: OwnerID): ScopeFamiliarity {
    const ownerFacts = this.getFactsForOwner(ownerId)
    if (ownerFacts.length > 0) {
      this.cacheHits++
    } else {
      this.cacheMisses++
    }

    const keyInterfaces = ownerFacts
      .filter((f) => f.category === "interface")
      .map((f) => `${f.key}: ${f.value}`)

    const tokenSavingsEstimate = ownerFacts.length * 45

    const familiarity: ScopeFamiliarity = {
      ownerId,
      facts: ownerFacts,
      keyInterfaces,
      recentChanges: [],
      tokenSavingsEstimate,
    }
    return familiarity
  }

  invalidateChangedFiles(ownerId: OwnerID, changedPaths: readonly string[]): {
    readonly invalidated: number
    readonly retained: number
  } {
    const changedSet = new Set(changedPaths.map((p) => p.replaceAll("\\", "/")))
    let invalidated = 0
    let retained = 0

    for (const [id, fact] of this.facts.entries()) {
      if (fact.ownerId !== ownerId) continue
      if (fact.sourcePath && changedSet.has(fact.sourcePath.replaceAll("\\", "/"))) {
        this.facts.delete(id)
        invalidated++
      } else {
        retained++
      }
    }

    const result = { invalidated, retained }
    return result
  }

  getMetrics(): MemoryMetrics {
    const metrics: MemoryMetrics = {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      tokensSavedEstimate: this.cacheHits * 250,
    }
    return metrics
  }

  renderFamiliarityContext(familiarity: ScopeFamiliarity): string | undefined {
    if (familiarity.facts.length === 0) return undefined
    const lines = familiarity.facts.map(
      (f) => `- [${f.category}] ${f.key}: ${f.value}${f.sourcePath ? ` (${f.sourcePath})` : ""}`
    )
    const block = [
      `=== SCOPE FAMILIARITY WARM-START (${familiarity.ownerId}) ===`,
      "Verified architecture and interface facts loaded from scope memory:",
      ...lines,
      "=== END SCOPE FAMILIARITY ===",
    ].join("\n")
    return block
  }
}

export class ObservationCache {
  private readonly cache = new Map<string, SourceObservation>()

  get(path: string, mtimeMs?: number): SourceObservation | undefined {
    const norm = path.replaceAll("\\", "/")
    const entry = this.cache.get(norm)
    if (!entry) return undefined
    if (mtimeMs !== undefined && entry.mtimeMs < mtimeMs) {
      this.cache.delete(norm)
      return undefined
    }
    return entry
  }

  set(obs: SourceObservation): void {
    const norm = obs.path.replaceAll("\\", "/")
    this.cache.set(norm, obs)
  }

  hasRecent(path: string, maxAgeMs = 60_000): boolean {
    const norm = path.replaceAll("\\", "/")
    const entry = this.cache.get(norm)
    if (!entry) return false
    const recent = Date.now() - entry.observedAt < maxAgeMs
    return recent
  }

  clear(): void {
    this.cache.clear()
  }
}

export class PeerAgentRuntime {
  readonly memoryStore: ScopeMemoryStore
  readonly observationCache: ObservationCache
  private readonly checkpoints = new Map<string, OwnerCheckpoint[]>()

  constructor(memoryStore?: ScopeMemoryStore, observationCache?: ObservationCache) {
    this.memoryStore = memoryStore ?? new ScopeMemoryStore()
    this.observationCache = observationCache ?? new ObservationCache()
  }

  prepareExecutionPacket(input: {
    readonly taskId: string
    readonly ownerId: OwnerID
    readonly goal: string
    readonly scopePaths: readonly string[]
    readonly budget: HierarchicalBudget | ExecutionBudget
    readonly workGraphNodeId?: string
    readonly parentSessionId?: string
    readonly callerOwnerId?: OwnerID
  }): ExecutionPacket {
    const sourceObservations: SourceObservation[] = []
    for (const p of input.scopePaths) {
      const cached = this.observationCache.get(p)
      if (cached) {
        sourceObservations.push(cached)
      }
    }

    const packet: ExecutionPacket = {
      taskId: input.taskId,
      ownerId: input.ownerId,
      goal: input.goal,
      scopePaths: input.scopePaths,
      budget: input.budget,
      sourceObservations,
      workGraphNodeId: input.workGraphNodeId,
      parentSessionId: input.parentSessionId,
      callerOwnerId: input.callerOwnerId,
      createdAt: Date.now(),
    }
    return packet
  }

  recordCheckpoint(checkpoint: OwnerCheckpoint): void {
    const existing = this.checkpoints.get(checkpoint.taskId) ?? []
    existing.push(checkpoint)
    this.checkpoints.set(checkpoint.taskId, existing)
  }

  getCheckpoints(taskId: string): readonly OwnerCheckpoint[] {
    return this.checkpoints.get(taskId) ?? []
  }

  createHandoff(input: {
    readonly fromOwnerId: OwnerID
    readonly toOwnerId: OwnerID
    readonly taskId: string
    readonly reason: string
    readonly sharedScope: readonly string[]
    readonly suggestedAction: string
    readonly contextPayload?: Readonly<Record<string, unknown>>
  }): OwnerHandoff {
    const handoff: OwnerHandoff = {
      fromOwnerId: input.fromOwnerId,
      toOwnerId: input.toOwnerId,
      taskId: input.taskId,
      reason: input.reason,
      sharedScope: input.sharedScope,
      suggestedAction: input.suggestedAction,
      contextPayload: input.contextPayload,
    }
    return handoff
  }

  createExecutionResult(input: {
    readonly taskId: string
    readonly ownerId: OwnerID
    readonly status: "completed" | "failed" | "blocked" | "yielded"
    readonly summary: string
    readonly touchedFiles?: readonly string[]
    readonly producedArtifacts?: readonly string[]
    readonly consumedBudget: {
      readonly turns: number
      readonly tokens: number
      readonly toolCalls: number
      readonly elapsedMs: number
    }
    readonly handoff?: OwnerHandoff
    readonly error?: string
  }): ExecutionResult {
    const taskCheckpoints = this.getCheckpoints(input.taskId)
    const latestCheckpoint = taskCheckpoints[taskCheckpoints.length - 1]

    const result: ExecutionResult = {
      taskId: input.taskId,
      ownerId: input.ownerId,
      status: input.status,
      summary: input.summary,
      touchedFiles: input.touchedFiles ?? [],
      producedArtifacts: input.producedArtifacts ?? [],
      consumedBudget: input.consumedBudget,
      checkpoint: latestCheckpoint,
      handoff: input.handoff,
      error: input.error,
      completedAt: Date.now(),
    }
    return result
  }
}

export * as PeerRuntime from "./peer-runtime"
