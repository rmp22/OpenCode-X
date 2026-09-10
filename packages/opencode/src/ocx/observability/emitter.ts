import type { SessionMetrics, TrajectoryEvent, TrajectoryEventType } from "./types"

export function redactSecrets(data: unknown): unknown {
  const secretPatterns = [
    /bearer\s+[a-zA-Z0-9_\-.]+/gi,
    /(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[a-zA-Z0-9_\-.]+["']?/gi,
  ]

  if (typeof data === "string") {
    let redacted = data
    for (const pattern of secretPatterns) {
      redacted = redacted.replace(pattern, "[REDACTED_SECRET]")
    }
    return redacted
  }

  if (data && typeof data === "object") {
    if (Array.isArray(data)) {
      return data.map((item) => redactSecrets(item))
    }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      result[k] = redactSecrets(v)
    }
    return result
  }

  return data
}

export class TrajectoryEmitter {
  private events: TrajectoryEvent[] = []
  private sessionId: string
  private startTime: number

  constructor(sessionId: string) {
    this.sessionId = sessionId
    this.startTime = Date.now()
  }

  emit(type: TrajectoryEventType, payload: Record<string, unknown>): TrajectoryEvent {
    const event: TrajectoryEvent = {
      id: `traj-${this.events.length + 1}`,
      sessionId: this.sessionId,
      type,
      timestamp: Date.now(),
      payload: redactSecrets(payload) as Record<string, unknown>,
    }
    this.events.push(event)
    return event
  }

  getEvents(): TrajectoryEvent[] {
    return [...this.events]
  }

  computeMetrics(): SessionMetrics {
    let totalTurns = 0
    let toolInvocations = 0
    let failedToolCalls = 0
    let mutationsApplied = 0
    let claimsVerified = 0
    let claimsFalsified = 0

    for (const ev of this.events) {
      if (ev.type === "turn_start") totalTurns++
      if (ev.type === "tool_call") toolInvocations++
      if (ev.type === "tool_result" && ev.payload.status === "failure") failedToolCalls++
      if (ev.type === "mutation_applied") mutationsApplied++
      if (ev.type === "claim_evaluated") {
        if (ev.payload.state === "verified") claimsVerified++
        if (ev.payload.state === "falsified") claimsFalsified++
      }
    }

    return {
      sessionId: this.sessionId,
      totalTurns,
      toolInvocations,
      failedToolCalls,
      mutationsApplied,
      totalDurationMs: Date.now() - this.startTime,
      claimsVerified,
      claimsFalsified,
    }
  }

  clear(): void {
    this.events = []
    this.startTime = Date.now()
  }
}
