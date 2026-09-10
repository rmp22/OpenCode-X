export type TurnState = "admitted" | "executing" | "checkpointed" | "terminal"

export interface TurnRecord {
  sessionID: string
  turnID: string
  state: TurnState
  admittedAt: number
  updatedAt: number
  toolCalls: Array<{
    callID: string
    tool: string
    status: "pending" | "running" | "completed" | "failed"
    output?: unknown
  }>
}

export class InvalidTurnStateTransitionError extends Error {
  readonly _tag = "InvalidTurnStateTransitionError"
  constructor(public readonly from: TurnState, public readonly to: TurnState) {
    super(`Invalid turn state transition from ${from} to ${to}`)
  }
}

export class TurnLifecycleManager {
  private turns = new Map<string, TurnRecord>()

  admit(sessionID: string, turnID: string): TurnRecord {
    const existing = this.turns.get(turnID)
    if (existing) {
      return existing
    }
    const record: TurnRecord = {
      sessionID,
      turnID,
      state: "admitted",
      admittedAt: Date.now(),
      updatedAt: Date.now(),
      toolCalls: [],
    }
    this.turns.set(turnID, record)
    return record
  }

  transition(turnID: string, to: TurnState): TurnRecord {
    const current = this.turns.get(turnID)
    if (!current) {
      throw new Error(`Turn ${turnID} not found`)
    }

    if (current.state === to) {
      return current
    }

    if (current.state === "terminal") {
      return current
    }

    const validTransitions: Record<TurnState, TurnState[]> = {
      admitted: ["executing", "terminal"],
      executing: ["checkpointed", "terminal"],
      checkpointed: ["terminal", "executing"],
      terminal: [],
    }

    if (!validTransitions[current.state].includes(to)) {
      throw new InvalidTurnStateTransitionError(current.state, to)
    }

    current.state = to
    current.updatedAt = Date.now()
    return current
  }

  recordToolExecution(
    turnID: string,
    toolCall: {
      callID: string
      tool: string
      status: "pending" | "running" | "completed" | "failed"
      output?: unknown
    },
  ): void {
    const current = this.turns.get(turnID)
    if (!current) return
    const existingIndex = current.toolCalls.findIndex((t) => t.callID === toolCall.callID)
    if (existingIndex >= 0) {
      current.toolCalls[existingIndex] = toolCall
    } else {
      current.toolCalls.push(toolCall)
    }
    current.updatedAt = Date.now()
  }

  rehydrate(journalRecord: TurnRecord): TurnRecord {
    const existing = this.turns.get(journalRecord.turnID)
    if (existing && existing.state === "terminal") {
      return existing
    }

    if (journalRecord.state === "terminal") {
      this.turns.set(journalRecord.turnID, { ...journalRecord })
      return this.turns.get(journalRecord.turnID)!
    }

    const reconciled: TurnRecord = {
      ...journalRecord,
      toolCalls: journalRecord.toolCalls.map((call) => {
        if (call.status === "running") {
          return { ...call, status: "failed", output: "interrupted_by_server_restart" }
        }
        return call
      }),
      state: journalRecord.state === "checkpointed" ? "checkpointed" : "terminal",
      updatedAt: Date.now(),
    }

    this.turns.set(journalRecord.turnID, reconciled)
    return reconciled
  }

  getTurn(turnID: string): TurnRecord | undefined {
    return this.turns.get(turnID)
  }

  clear(turnID: string): void {
    this.turns.delete(turnID)
  }
}

export const defaultTurnLifecycle = new TurnLifecycleManager()
