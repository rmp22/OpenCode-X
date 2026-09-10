import { MaxSubagentRecursionError, type DomainOwnerType, type SubagentResult, type SubagentTask } from "./types"

export class DomainOwnerRegistry {
  private domainMemories = new Map<DomainOwnerType, Map<string, unknown>>()
  private activeLocks = new Map<DomainOwnerType, Promise<void>>()
  private readonly maxRecursionDepth: number

  constructor(maxRecursionDepth = 3) {
    this.maxRecursionDepth = maxRecursionDepth
  }

  setDomainMemory(owner: DomainOwnerType, key: string, value: unknown): void {
    let mem = this.domainMemories.get(owner)
    if (!mem) {
      mem = new Map()
      this.domainMemories.set(owner, mem)
    }
    mem.set(key, value)
  }

  getDomainMemory(owner: DomainOwnerType, key: string): unknown | undefined {
    return this.domainMemories.get(owner)?.get(key)
  }

  async executeWithDomainLock<T>(owner: DomainOwnerType, fn: () => Promise<T>): Promise<T> {
    while (this.activeLocks.has(owner)) {
      await this.activeLocks.get(owner)
    }

    let releaseLock: () => void
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    this.activeLocks.set(owner, lockPromise)

    try {
      return await fn()
    } finally {
      this.activeLocks.delete(owner)
      releaseLock!()
    }
  }

  async delegateTask(
    task: SubagentTask,
    executor: (t: SubagentTask) => Promise<SubagentResult>,
  ): Promise<SubagentResult> {
    if (task.depth > this.maxRecursionDepth) {
      throw new MaxSubagentRecursionError(task.depth, this.maxRecursionDepth)
    }

    return this.executeWithDomainLock(task.owner, async () => {
      const result = await executor(task)
      if (result.subsystemMemoryUpdates) {
        for (const [k, v] of Object.entries(result.subsystemMemoryUpdates)) {
          this.setDomainMemory(task.owner, k, v)
        }
      }
      return result
    })
  }

  clear(): void {
    this.domainMemories.clear()
    this.activeLocks.clear()
  }
}

export const defaultDomainOwnerRegistry = new DomainOwnerRegistry()
