import type { HierarchicalBudget } from "./types"

export type ExecutionConvergenceStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED"

export type StructuredConvergenceResult = {
  readonly status: ExecutionConvergenceStatus
  readonly summary: string
  readonly evidence: readonly string[]
  readonly changes: readonly string[]
  readonly limitations: readonly string[]
  readonly next?: string
  readonly metrics: {
    readonly turns: number
    readonly tokens: number
    readonly toolCalls: number
    readonly elapsedMs: number
  }
}

export type CycleBreakerVerdict = {
  readonly shouldBreak: boolean
  readonly reason?: string
}

export class ProgressCycleBreaker {
  private readonly callHistory: string[] = []
  private readonly touchedFiles = new Set<string>()
  private stepsWithoutProgress = 0
  readonly maxIdenticalCalls: number
  readonly maxStallSteps: number

  constructor(maxIdenticalCalls = 2, maxStallSteps = 4) {
    this.maxIdenticalCalls = maxIdenticalCalls
    this.maxStallSteps = maxStallSteps
  }

  recordFileTouch(path: string): void {
    this.touchedFiles.add(path.replaceAll("\\", "/"))
    this.stepsWithoutProgress = 0
  }

  recordStep(tool: string, args: unknown): CycleBreakerVerdict {
    const signature = `${tool}:${JSON.stringify(args ?? {})}`
    this.callHistory.push(signature)

    const count = this.callHistory.filter((sig) => sig === signature).length
    if (count >= this.maxIdenticalCalls) {
      const verdict: CycleBreakerVerdict = {
        shouldBreak: true,
        reason: `Progress cycle broken: tool '${tool}' called with identical arguments ${count} times without progress`,
      }
      return verdict
    }

    const len = this.callHistory.length
    if (len >= 4) {
      const a1 = this.callHistory[len - 4]
      const b1 = this.callHistory[len - 3]
      const a2 = this.callHistory[len - 2]
      const b2 = this.callHistory[len - 1]
      if (a1 === a2 && b1 === b2 && a1 !== b1) {
        const verdict: CycleBreakerVerdict = {
          shouldBreak: true,
          reason: `Progress cycle broken: ping-pong alternating pattern detected between '${a1.split(":")[0]}' and '${b1.split(":")[0]}'`,
        }
        return verdict
      }
    }

    this.stepsWithoutProgress++
    if (this.stepsWithoutProgress >= this.maxStallSteps && this.touchedFiles.size === 0) {
      const verdict: CycleBreakerVerdict = {
        shouldBreak: true,
        reason: `Progress cycle broken: ${this.stepsWithoutProgress} steps without file modification or state progress`,
      }
      return verdict
    }

    const normal: CycleBreakerVerdict = { shouldBreak: false }
    return normal
  }

  reset(): void {
    this.callHistory.length = 0
    this.touchedFiles.clear()
    this.stepsWithoutProgress = 0
  }
}

export class HierarchicalBudgetTracker {
  private budget: HierarchicalBudget
  private readonly startTime = Date.now()

  constructor(initialBudget: HierarchicalBudget) {
    this.budget = initialBudget
  }

  static createDefault(maxTurns = 8, maxTokens = 50_000, maxToolCalls = 25, wallClockMs = 60_000): HierarchicalBudgetTracker {
    const budget: HierarchicalBudget = {
      rootBudget: {
        maxTurns: maxTurns * 2,
        maxTokens: maxTokens * 2,
        maxToolCalls: maxToolCalls * 2,
        wallClockMs: wallClockMs * 2,
      },
      ownerAllocated: {
        maxTurns,
        maxTokens,
        maxToolCalls,
        wallClockMs,
      },
      consumed: {
        turns: 0,
        tokens: 0,
        toolCalls: 0,
        elapsedMs: 0,
      },
      remainingTurns: maxTurns,
      remainingTokens: maxTokens,
      remainingToolCalls: maxToolCalls,
      remainingTimeMs: wallClockMs,
    }
    return new HierarchicalBudgetTracker(budget)
  }

  recordTurn(tokensConsumed = 0): { readonly exhausted: boolean; readonly remainingTurns: number; readonly mustCheckpoint: boolean } {
    const nextTurns = this.budget.consumed.turns + 1
    const nextTokens = this.budget.consumed.tokens + tokensConsumed
    const elapsed = Date.now() - this.startTime

    const remainingTurns = Math.max(0, this.budget.ownerAllocated.maxTurns - nextTurns)
    const remainingTokens = Math.max(0, this.budget.ownerAllocated.maxTokens - nextTokens)
    const remainingTime = Math.max(0, this.budget.ownerAllocated.wallClockMs - elapsed)

    this.budget = {
      ...this.budget,
      consumed: {
        ...this.budget.consumed,
        turns: nextTurns,
        tokens: nextTokens,
        elapsedMs: elapsed,
      },
      remainingTurns,
      remainingTokens,
      remainingTimeMs: remainingTime,
    }

    const exhausted = remainingTurns <= 0 || remainingTokens <= 0 || remainingTime <= 0
    const mustCheckpoint = remainingTurns <= 1 || remainingTokens <= 5_000

    const result = { exhausted, remainingTurns, mustCheckpoint }
    return result
  }

  recordToolCall(): { readonly allowed: boolean; readonly remainingToolCalls: number } {
    const nextToolCalls = this.budget.consumed.toolCalls + 1
    const remaining = Math.max(0, this.budget.ownerAllocated.maxToolCalls - nextToolCalls)

    this.budget = {
      ...this.budget,
      consumed: {
        ...this.budget.consumed,
        toolCalls: nextToolCalls,
      },
      remainingToolCalls: remaining,
    }

    const allowed = remaining > 0
    const res = { allowed, remainingToolCalls: remaining }
    return res
  }

  canExecute(): boolean {
    const timeRemaining = Date.now() - this.startTime < this.budget.ownerAllocated.wallClockMs
    return this.budget.remainingTurns > 0 && this.budget.remainingTokens > 0 && timeRemaining
  }

  snapshot(): HierarchicalBudget {
    return this.budget
  }
}

export class ToolHealthTracker {
  private readonly failureCounts = new Map<string, number>()
  readonly maxConsecutiveFailures: number

  constructor(maxConsecutiveFailures = 3) {
    this.maxConsecutiveFailures = maxConsecutiveFailures
  }

  recordSuccess(tool: string): void {
    this.failureCounts.set(tool, 0)
  }

  recordFailure(tool: string): { readonly isUnhealthy: boolean; readonly consecutiveFailures: number } {
    const prev = this.failureCounts.get(tool) ?? 0
    const current = prev + 1
    this.failureCounts.set(tool, current)

    const isUnhealthy = current >= this.maxConsecutiveFailures
    const result = { isUnhealthy, consecutiveFailures: current }
    return result
  }

  isHealthy(tool: string): boolean {
    const count = this.failureCounts.get(tool) ?? 0
    return count < this.maxConsecutiveFailures
  }

  reset(): void {
    this.failureCounts.clear()
  }
}

export class ResearchGovernor {
  private count = 0
  readonly maxResearchCalls: number

  constructor(maxResearchCalls = 4) {
    this.maxResearchCalls = maxResearchCalls
  }

  canResearch(): boolean {
    return this.count < this.maxResearchCalls
  }

  recordResearchCall(): { readonly allowed: boolean; readonly remaining: number } {
    if (this.count >= this.maxResearchCalls) {
      const blocked = { allowed: false, remaining: 0 }
      return blocked
    }
    this.count++
    const remaining = this.maxResearchCalls - this.count
    const ok = { allowed: true, remaining }
    return ok
  }

  reset(): void {
    this.count = 0
  }
}

export * as OwnerGovernance from "./governance"
