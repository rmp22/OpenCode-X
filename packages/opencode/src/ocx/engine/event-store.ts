import { initial, reduce, type EngineEvent, type TaskState } from "./state-machine"

export interface StoredEvent {
  readonly sequence: number
  readonly sessionID: string
  readonly event: EngineEvent
  readonly timestamp: number
}

export interface SessionSnapshot {
  readonly sessionID: string
  readonly lastSequence: number
  readonly state: TaskState
  readonly timestamp: number
}

export class EventStore {
  private readonly events = new Map<string, StoredEvent[]>()
  private readonly snapshots = new Map<string, SessionSnapshot>()

  append(sessionID: string, event: EngineEvent): StoredEvent {
    const stream = this.events.get(sessionID) ?? []
    const sequence = stream.length + 1
    const stored: StoredEvent = {
      sequence,
      sessionID,
      event,
      timestamp: Date.now(),
    }
    stream.push(stored)
    this.events.set(sessionID, stream)

    const currentSnapshot = this.snapshots.get(sessionID)
    const currentState = currentSnapshot ? currentSnapshot.state : initial(sessionID)
    const nextState = reduce(currentState, event)
    this.snapshots.set(sessionID, {
      sessionID,
      lastSequence: sequence,
      state: nextState,
      timestamp: stored.timestamp,
    })

    return stored
  }

  getEvents(sessionID: string, fromSequence = 1): readonly StoredEvent[] {
    const stream = this.events.get(sessionID) ?? []
    return stream.filter((e) => e.sequence >= fromSequence)
  }

  getSnapshot(sessionID: string): TaskState {
    const snapshot = this.snapshots.get(sessionID)
    if (snapshot) return snapshot.state
    return initial(sessionID)
  }

  replay(sessionID: string): TaskState {
    const stream = this.events.get(sessionID) ?? []
    let state = initial(sessionID)
    for (const stored of stream) {
      state = reduce(state, stored.event)
    }
    return state
  }

  clear(sessionID: string): void {
    this.events.delete(sessionID)
    this.snapshots.delete(sessionID)
  }
}

export const sharedEventStore = new EventStore()

export * as EventStoreModule from "./event-store"
