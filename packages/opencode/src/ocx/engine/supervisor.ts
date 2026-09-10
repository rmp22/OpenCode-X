import { sharedEventStore } from "./event-store"
import { type TaskState, reduce, initial } from "./state-machine"

export interface SessionRunHandle {
  readonly sessionID: string
  readonly abortController: AbortController
  readonly startTime: number
}

export class SessionSupervisor {
  private readonly activeSessions = new Map<string, SessionRunHandle>()
  private readonly rateLimitBackoffs = new Map<string, number>()

  acquire(sessionID: string): SessionRunHandle {
    const existing = this.activeSessions.get(sessionID)
    if (existing) return existing

    const handle: SessionRunHandle = {
      sessionID,
      abortController: new AbortController(),
      startTime: Date.now(),
    }
    this.activeSessions.set(sessionID, handle)
    return handle
  }

  interrupt(sessionID: string, reason?: string): boolean {
    const handle = this.activeSessions.get(sessionID)
    if (!handle) return false

    handle.abortController.abort(reason ?? "User interrupted session")
    this.activeSessions.delete(sessionID)

    sharedEventStore.append(sessionID, {
      type: "STAGE_TRANSITIONED",
      from: "execute",
      to: "blocked",
      reason: reason ?? "interrupted",
    })
    return true
  }

  recordRateLimit(provider: string, backoffMs = 2000): void {
    const current = this.rateLimitBackoffs.get(provider) ?? 0
    const next = Math.min(current === 0 ? backoffMs : current * 2, 60000)
    this.rateLimitBackoffs.set(provider, next)
  }

  getRateLimitDelay(provider: string): number {
    return this.rateLimitBackoffs.get(provider) ?? 0
  }

  clearRateLimit(provider: string): void {
    this.rateLimitBackoffs.delete(provider)
  }

  recoverSession(sessionID: string): TaskState {
    const events = sharedEventStore.getEvents(sessionID)
    let state = initial(sessionID)
    for (const stored of events) {
      state = reduce(state, stored.event)
    }
    return state
  }

  release(sessionID: string): void {
    this.activeSessions.delete(sessionID)
  }
}

export const sharedSupervisor = new SessionSupervisor()

export * as SessionSupervisorModule from "./supervisor"
