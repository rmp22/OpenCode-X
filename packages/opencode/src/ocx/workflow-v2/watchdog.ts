export type LaneBudget = {
  maxTurns?: number
  maxDurationMs?: number
  maxToolCalls?: number
  consecutiveStallTurns?: number
}

export type LaneUsage = {
  turns: number
  startTime: number
  elapsedMs: number
  toolCalls: number
  stalledTurns: number
}

export type WatchdogStatus = {
  exceeded: boolean
  stalled: boolean
  reason?: string
}

export class LaneWatchdog {
  readonly budget: Required<LaneBudget>
  private turns = 0
  private toolCalls = 0
  private stalledTurns = 0
  private startTime = Date.now()

  constructor(budget: LaneBudget = {}) {
    this.budget = {
      maxTurns: budget.maxTurns ?? 25,
      maxDurationMs: budget.maxDurationMs ?? 300_000,
      maxToolCalls: budget.maxToolCalls ?? 60,
      consecutiveStallTurns: budget.consecutiveStallTurns ?? 3,
    }
  }

  recordTurn(hasProgressMarker = true) {
    this.turns += 1
    if (hasProgressMarker) {
      this.stalledTurns = 0
    } else {
      this.stalledTurns += 1
    }
  }

  recordToolCall() {
    this.toolCalls += 1
  }

  getUsage(): LaneUsage {
    const elapsedMs = Date.now() - this.startTime
    return {
      turns: this.turns,
      startTime: this.startTime,
      elapsedMs,
      toolCalls: this.toolCalls,
      stalledTurns: this.stalledTurns,
    }
  }

  check(): WatchdogStatus {
    const usage = this.getUsage()
    if (usage.turns >= this.budget.maxTurns) {
      return { exceeded: true, stalled: false, reason: `turn budget exceeded (${usage.turns}/${this.budget.maxTurns})` }
    }
    if (usage.elapsedMs >= this.budget.maxDurationMs) {
      return { exceeded: true, stalled: false, reason: `duration budget exceeded (${usage.elapsedMs}ms/${this.budget.maxDurationMs}ms)` }
    }
    if (usage.toolCalls >= this.budget.maxToolCalls) {
      return { exceeded: true, stalled: false, reason: `tool call budget exceeded (${usage.toolCalls}/${this.budget.maxToolCalls})` }
    }
    if (usage.stalledTurns >= this.budget.consecutiveStallTurns) {
      return { exceeded: false, stalled: true, reason: `stall detected: ${usage.stalledTurns} consecutive turns without progress` }
    }
    return { exceeded: false, stalled: false }
  }
}

export * as Watchdog from "./watchdog"
