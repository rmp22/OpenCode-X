import type {
  LoopPatternKind,
  EscalationAction,
  LoopBudget,
  LoopBudgetState,
  RecoverySuggestion,
} from "./types"

export class LoopController {
  private readonly toolHistory: string[] = []
  private readonly readHistory: string[] = []
  private consecutiveErrors = 0
  private noProgressTurns = 0

  private budget: LoopBudget = {
    maxAttempts: 50,
    maxCost: 10.0,
    maxDurationMs: 1000 * 60 * 30,
  }
  private attempts = 0
  private spentCost = 0
  private readonly startTime = Date.now()

  setBudget(budget: LoopBudget): void {
    this.budget = { ...this.budget, ...budget }
  }

  checkBudget(): LoopBudgetState {
    let isExhausted = false
    let exhaustionReason: string | undefined

    if (this.budget.maxAttempts !== undefined && this.attempts >= this.budget.maxAttempts) {
      isExhausted = true
      exhaustionReason = "Max attempts exceeded (" + this.attempts + "/" + this.budget.maxAttempts + ")"
    } else if (this.budget.maxCost !== undefined && this.spentCost >= this.budget.maxCost) {
      isExhausted = true
      exhaustionReason = "Max budget cost exceeded ($" + this.spentCost + "/$" + this.budget.maxCost + ")"
    } else if (this.budget.maxDurationMs !== undefined && Date.now() - this.startTime >= this.budget.maxDurationMs) {
      isExhausted = true
      exhaustionReason = "Max duration exceeded"
    }

    const state: LoopBudgetState = {
      attempts: this.attempts,
      spentCost: this.spentCost,
      startTime: this.startTime,
      isExhausted,
      exhaustionReason,
    }
    return state
  }

  recordInvocation(tool: string, args = "", output = "", isError = false, cost = 0): EscalationAction {
    this.attempts++
    this.spentCost += cost
    this.recordToolCall(tool, args)
    if (isError) {
      this.recordError(output || tool)
    } else {
      this.recordSuccess()
    }
    return this.evaluate()
  }

  recordNoProgressTurn(): EscalationAction {
    this.attempts++
    this.noProgressTurns++
    return this.evaluate()
  }

  recordToolCall(toolName: string, argsHash = ""): void {
    const signature = toolName + ":" + argsHash
    this.toolHistory.push(signature)
    if (this.toolHistory.length > 50) this.toolHistory.shift()

    if (toolName === "read") {
      this.recordRead(argsHash)
    }
  }

  recordRead(filePath: string): void {
    this.readHistory.push(filePath)
    if (this.readHistory.length > 50) this.readHistory.shift()
  }

  recordError(_toolName?: string): void {
    this.consecutiveErrors += 1
  }

  recordSuccess(): void {
    this.consecutiveErrors = 0
  }

  detectPattern(): LoopPatternKind | undefined {
    const recentIdentical = this.toolHistory.slice(-4)
    if (recentIdentical.length >= 2 && recentIdentical[recentIdentical.length - 1] === recentIdentical[recentIdentical.length - 2]) {
      return "identical_tool"
    }

    const count = this.readHistory.slice(-5).filter((f) => f === this.readHistory[this.readHistory.length - 1]).length
    if (count >= 3) {
      return "read_thrash"
    }

    if (this.consecutiveErrors >= 3) {
      return "error_cycle"
    }

    if (this.noProgressTurns >= 2) {
      return "no_progress_turn"
    }

    return undefined
  }

  generateRecoveryAction(pattern: LoopPatternKind): RecoverySuggestion {
    switch (pattern) {
      case "identical_tool":
      case "identical_tool_calls": {
        const suggestion: RecoverySuggestion = {
          pattern: "identical_tool",
          strategy: "parameter_variation",
          suggestedAction: "Vary input arguments, inspect target file range, or delegate to subagent",
          alternativeTools: ["read", "grep", "task"],
          explanation: "Repeated identical invocations detected. Vary arguments or inspect surroundings.",
        }
        return suggestion
      }
      case "read_thrash":
      case "repetitive_reads": {
        const suggestion: RecoverySuggestion = {
          pattern: "read_thrash",
          strategy: "bounded_context_synthesis",
          suggestedAction: "Synthesize findings into an execution plan instead of re-reading",
          alternativeTools: ["todowrite", "ocx_plan", "edit"],
          explanation: "Repeated reads on the same file without mutation. Synthesize and act.",
        }
        return suggestion
      }
      case "error_cycle":
      case "consecutive_errors": {
        const suggestion: RecoverySuggestion = {
          pattern: "error_cycle",
          strategy: "hypothesis_inversion",
          suggestedAction: "Step back, trace causal chain, or write rubber-duck diagnosis",
          alternativeTools: ["read", "bash", "question"],
          explanation: "Continuous error cycle detected. Invert hypothesis and diagnose root cause.",
        }
        return suggestion
      }
      case "no_progress_turn":
      default: {
        const suggestion: RecoverySuggestion = {
          pattern: "no_progress_turn",
          strategy: "subgoal_decomposition",
          suggestedAction: "Decompose target into smaller verifiable subgoals",
          alternativeTools: ["todowrite", "task"],
          explanation: "Multiple turns elapsed with no state advancement. Break work down.",
        }
        return suggestion
      }
    }
  }

  escalateLadder(level: 1 | 2 | 3 | 4, pattern: LoopPatternKind): EscalationAction {
    switch (level) {
      case 1: {
        const action: EscalationAction = {
          level: 1,
          kind: "advisory",
          message: "Level 1 soft advisory: detected loop pattern " + pattern + ". Ensure forward progress.",
          pattern,
        }
        return action
      }
      case 2: {
        const action: EscalationAction = {
          level: 2,
          kind: "strict_instruction",
          message: "Level 2 hard instruction: repetitive " + pattern + " detected. Stop repeating and switch approach.",
          lockedTools: ["read", "write"],
          pattern,
        }
        return action
      }
      case 3: {
        const recovery = this.generateRecoveryAction(pattern)
        const action: EscalationAction = {
          level: 3,
          kind: "strategy_pivot",
          message: "Level 3 strategy pivot: switching strategy to " + recovery.strategy + " and requesting rollback",
          reason: "circuit_breaker",
          alternativeStrategy: recovery.strategy,
          rollbackRequested: true,
          pattern,
        }
        return action
      }
      case 4: {
        const action: EscalationAction = {
          level: 4,
          kind: "suspension",
          message: "Level 4 suspension / HITL: unrecovered loop " + pattern + " requires human intervention",
          suspensionKind: "circuit_breaker",
          pattern,
        }
        return action
      }
    }
  }

  evaluate(): EscalationAction {
    const budgetState = this.checkBudget()
    if (budgetState.isExhausted) {
      const exhaustedAction: EscalationAction = {
        level: 4,
        kind: "suspension",
        message: "Loop execution halted: " + budgetState.exhaustionReason,
        suspensionKind: "circuit_breaker",
      }
      return exhaustedAction
    }

    if (this.consecutiveErrors >= 5) {
      const level3Action: EscalationAction = {
        level: 3,
        kind: "suspension",
        message: "Circuit breaker triggered: 5 consecutive tool failures",
        reason: "circuit_breaker",
        alternativeStrategy: "hypothesis_inversion",
        rollbackRequested: true,
        pattern: "consecutive_errors",
      }
      return level3Action
    }

    const recentIdentical = this.toolHistory.slice(-4)
    if (recentIdentical.length >= 4 && new Set(recentIdentical).size === 1) {
      const tool = recentIdentical[0].split(":")[0]
      const level4Action: EscalationAction = {
        level: 4,
        kind: "abort",
        message: 'Persistent infinite loop detected on tool "' + tool + '" (4 consecutive identical calls)',
        pattern: "identical_tool",
      }
      return level4Action
    }

    if (recentIdentical.length >= 3 && new Set(recentIdentical).size === 1) {
      const tool = recentIdentical[0].split(":")[0]
      const level2Action: EscalationAction = {
        level: 2,
        kind: "strict_instruction",
        message: 'Repeated identical calls to "' + tool + '". Stop repeating and switch approach.',
        lockedTools: [tool],
        pattern: "identical_tool",
      }
      return level2Action
    }

    const recentReads = this.readHistory.slice(-3)
    if (recentReads.length >= 3 && new Set(recentReads).size === 1) {
      const level2Action: EscalationAction = {
        level: 2,
        kind: "strict_instruction",
        message: 'Repeated reading of "' + recentReads[0] + '" without forward progress. Gather evidence and proceed.',
        lockedTools: ["read"],
        pattern: "read_thrash",
      }
      return level2Action
    }

    if (recentIdentical.length >= 2 && recentIdentical[recentIdentical.length - 1] === recentIdentical[recentIdentical.length - 2]) {
      const tool = recentIdentical[0].split(":")[0]
      const level1Action: EscalationAction = {
        level: 1,
        kind: "advisory",
        message: 'Notice: repeated call to "' + tool + '". Ensure you are making progress.',
        pattern: "identical_tool",
      }
      return level1Action
    }

    if (this.noProgressTurns >= 2) {
      const level1Action: EscalationAction = {
        level: 1,
        kind: "advisory",
        message: "Notice: multiple turns without state progress. Decompose current task.",
        pattern: "no_progress_turn",
      }
      return level1Action
    }

    const level0Action: EscalationAction = {
      level: 0,
      kind: "none",
    }
    return level0Action
  }

  reset(): void {
    this.toolHistory.length = 0
    this.readHistory.length = 0
    this.consecutiveErrors = 0
    this.noProgressTurns = 0
    this.attempts = 0
    this.spentCost = 0
  }
}

export const defaultLoopController = new LoopController()

export * as LoopControllerModule from "./controller"
