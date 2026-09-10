import type { ExecutionLane, LaneConfig, LaneTaskResult } from "./types"

export const DEFAULT_LANE_CONFIGS: Record<ExecutionLane, LaneConfig> = {
  interactive: {
    lane: "interactive",
    concurrency: 4,
    timeoutMs: 60000,
    priority: 1,
    allowedToolCategories: ["read", "mutate", "execute", "external", "administrative"],
    tokenBudget: 50000,
  },
  probe: {
    lane: "probe",
    concurrency: 8,
    timeoutMs: 15000,
    priority: 2,
    allowedToolCategories: ["read", "external"],
    tokenBudget: 20000,
  },
  batch: {
    lane: "batch",
    concurrency: 2,
    timeoutMs: 180000,
    priority: 3,
    allowedToolCategories: ["read", "mutate", "execute", "external", "administrative"],
    tokenBudget: 100000,
    maxRetries: 3,
  },
  autonomous: {
    lane: "autonomous",
    concurrency: 1,
    timeoutMs: 600000,
    priority: 4,
    allowedToolCategories: ["read", "mutate", "execute", "external", "administrative"],
    tokenBudget: 500000,
  },
  fast: {
    lane: "fast",
    concurrency: 4,
    timeoutMs: 30000,
    priority: 1,
    allowedToolCategories: ["read", "mutate", "execute", "external", "administrative"],
    tokenBudget: 50000,
  },
  standard: {
    lane: "standard",
    concurrency: 2,
    timeoutMs: 120000,
    priority: 2,
    allowedToolCategories: ["read", "mutate", "execute", "external", "administrative"],
    tokenBudget: 100000,
  },
  deep: {
    lane: "deep",
    concurrency: 1,
    timeoutMs: 300000,
    priority: 3,
    allowedToolCategories: ["read", "mutate", "execute", "external", "administrative"],
    tokenBudget: 300000,
  },
  research: {
    lane: "research",
    concurrency: 2,
    timeoutMs: 60000,
    priority: 2,
    allowedToolCategories: ["read", "external"],
    tokenBudget: 50000,
  },
}

type QueuedItem<T> = {
  readonly id: string
  readonly lane: ExecutionLane
  readonly execute: () => Promise<T>
  readonly timeoutMs: number
  readonly toolCategory?: string
  readonly tokenCost?: number
  readonly priority: number
  readonly resolve: (result: LaneTaskResult<T>) => void
}

export class LaneScheduler {
  private readonly configs: Record<ExecutionLane, LaneConfig>
  private readonly queues: Record<ExecutionLane, QueuedItem<any>[]> = {
    interactive: [],
    probe: [],
    batch: [],
    autonomous: [],
    fast: [],
    standard: [],
    deep: [],
    research: [],
  }
  private readonly active: Record<ExecutionLane, number> = {
    interactive: 0,
    probe: 0,
    batch: 0,
    autonomous: 0,
    fast: 0,
    standard: 0,
    deep: 0,
    research: 0,
  }

  constructor(configs?: Partial<Record<ExecutionLane, LaneConfig>>) {
    this.configs = {
      ...DEFAULT_LANE_CONFIGS,
      ...(configs ?? {}),
    }
  }

  enqueue<T>(
    lane: ExecutionLane,
    task: () => Promise<T>,
    options?: number | { readonly timeoutMs?: number; readonly toolCategory?: string; readonly tokenCost?: number },
  ): Promise<LaneTaskResult<T>> {
    const config = this.configs[lane]
    const timeoutMs = typeof options === "number" ? options : options?.timeoutMs ?? config.timeoutMs
    const toolCategory = typeof options === "object" ? options.toolCategory : undefined
    const tokenCost = typeof options === "object" ? options.tokenCost : undefined

    if (lane === "probe" && toolCategory === "mutate") {
      const blocked: LaneTaskResult<T> = {
        success: false,
        error: "Probe lane cannot execute mutating tools",
        durationMs: 0,
      }
      return Promise.resolve(blocked)
    }

    if (config.tokenBudget && tokenCost && tokenCost > config.tokenBudget) {
      const exceeded: LaneTaskResult<T> = {
        success: false,
        error: "Task exceeds lane token budget (" + tokenCost + " > " + config.tokenBudget + ")",
        durationMs: 0,
      }
      return Promise.resolve(exceeded)
    }

    const promise = new Promise<LaneTaskResult<T>>((resolve) => {
      const item: QueuedItem<T> = {
        id: "task_" + lane + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        lane,
        execute: task,
        timeoutMs,
        toolCategory,
        tokenCost,
        priority: config.priority,
        resolve,
      }
      this.queues[lane].push(item)
      this.processAllQueues()
    })
    return promise
  }

  activeCount(lane: ExecutionLane): number {
    return this.active[lane]
  }

  pendingCount(lane: ExecutionLane): number {
    return this.queues[lane].length
  }

  cancelLane(lane: ExecutionLane): number {
    const queue = this.queues[lane]
    const count = queue.length
    while (queue.length > 0) {
      const item = queue.shift()
      if (item) {
        item.resolve({
          success: false,
          error: `Task cancelled on lane "${lane}"`,
          durationMs: 0,
        })
      }
    }
    return count
  }

  cancelAll(): number {
    let total = 0
    for (const lane of Object.keys(this.queues) as ExecutionLane[]) {
      total += this.cancelLane(lane)
    }
    return total
  }

  private processAllQueues(): void {
    const allLanes = Object.keys(this.queues) as ExecutionLane[]
    allLanes.sort((a, b) => this.configs[a].priority - this.configs[b].priority)

    for (const lane of allLanes) {
      this.processQueue(lane)
    }
  }

  private processQueue(lane: ExecutionLane): void {
    const config = this.configs[lane]
    while (this.active[lane] < config.concurrency && this.queues[lane].length > 0) {
      const item = this.queues[lane].shift()
      if (!item) break
      this.runItem(item)
    }
  }

  private async runItem<T>(item: QueuedItem<T>): Promise<void> {
    this.active[item.lane] += 1
    const start = Date.now()

    let timer: any
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Task timed out after " + item.timeoutMs + "ms on lane \"" + item.lane + "\""))
      }, item.timeoutMs)
    })

    try {
      const res = await Promise.race([item.execute(), timeoutPromise])
      clearTimeout(timer)
      const durationMs = Date.now() - start
      const successResult: any = { success: true, result: res, data: res, durationMs }
      item.resolve(successResult)
    } catch (err: any) {
      clearTimeout(timer)
      const durationMs = Date.now() - start
      const failResult: LaneTaskResult<T> = {
        success: false,
        error: err?.message ?? String(err),
        durationMs,
      }
      item.resolve(failResult)
    } finally {
      this.active[item.lane] -= 1
      this.processAllQueues()
    }
  }
}

export const defaultLaneScheduler = new LaneScheduler()

export * as LaneSchedulerModule from "./scheduler"
