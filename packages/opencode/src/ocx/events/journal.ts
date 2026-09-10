import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { GraphEvent, JournalCompactionResult } from "./types"

export class EventJournal {
  private readonly sessionID: string
  private readonly logPath?: string
  private readonly memoryEvents: GraphEvent[] = []
  private readonly idempotencyKeys = new Set<string>()
  private currentSequence = 0

  constructor(sessionID: string, baseDir?: string) {
    this.sessionID = sessionID
    if (baseDir) {
      try {
        if (!existsSync(baseDir)) {
          mkdirSync(baseDir, { recursive: true })
        }
        this.logPath = join(baseDir, "events_" + sessionID + ".jsonl")
      } catch (_err) {
        void _err
      }
    }
  }

  append(event: GraphEvent): GraphEvent | undefined {
    if (event.idempotencyKey) {
      if (this.idempotencyKeys.has(event.idempotencyKey)) {
        const existing = this.memoryEvents.find((e) => e.idempotencyKey === event.idempotencyKey)
        return existing
      }
      this.idempotencyKeys.add(event.idempotencyKey)
    }

    const sequence = event.sequence !== undefined ? event.sequence : ++this.currentSequence
    if (sequence > this.currentSequence) {
      this.currentSequence = sequence
    }

    const completeEvent: GraphEvent = {
      id: event.id ?? ("ev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
      sessionID: event.sessionID ?? this.sessionID,
      ...event,
      sequence,
    }

    this.memoryEvents.push(completeEvent)

    if (this.logPath) {
      try {
        appendFileSync(this.logPath, JSON.stringify(completeEvent) + "\n", "utf8")
      } catch (_err) {
        void _err
      }
    }

    return completeEvent
  }

  readAll(): readonly GraphEvent[] {
    if (this.logPath && existsSync(this.logPath)) {
      try {
        const raw = readFileSync(this.logPath, "utf8")
        const lines = raw.split("\n").filter((l) => l.trim().length > 0)
        const parsedEvents: GraphEvent[] = []
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as GraphEvent
            if (parsed && typeof parsed.type === "string") {
              parsedEvents.push(parsed)
            }
          } catch (_parseErr) {
            void _parseErr
          }
        }
        return parsedEvents
      } catch (_err) {
        void _err
      }
    }
    return [...this.memoryEvents]
  }

  compact(snapshotSequence: number): JournalCompactionResult {
    const retained = this.readAll().filter((e) => (e.sequence ?? 0) >= snapshotSequence)
    this.memoryEvents.length = 0
    this.memoryEvents.push(...retained)

    if (this.logPath && existsSync(this.logPath)) {
      try {
        const content = retained.map((e) => JSON.stringify(e)).join("\n") + (retained.length > 0 ? "\n" : "")
        writeFileSync(this.logPath, content, "utf8")
      } catch (_err) {
        void _err
      }
    }

    const result: JournalCompactionResult = {
      sessionID: this.sessionID,
      compactedBeforeSequence: snapshotSequence,
      remainingEventsCount: retained.length,
    }
    return result
  }

  clear(): void {
    this.memoryEvents.length = 0
    this.idempotencyKeys.clear()
    this.currentSequence = 0
    if (this.logPath && existsSync(this.logPath)) {
      try {
        writeFileSync(this.logPath, "", "utf8")
      } catch (_err) {
        void _err
      }
    }
  }
}

export * as EventJournalModule from "./journal"
