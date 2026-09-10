export * as AgentMemory from "./agent-memory"

import { Effect } from "effect"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Global } from "@opencode-ai/core/global"

export type SessionMemory = {
  readonly workdir: string
  readonly objective: string
  readonly scope: string
  readonly phase: string
  readonly completed: readonly string[]
  readonly evidence: readonly string[]
  readonly corrections: readonly string[]
  readonly blocker?: string
  readonly nextAction: string
  readonly nextCheck: string
}

export interface Store {
  readonly get: (sessionID: string) => SessionMemory | undefined
  readonly set: (sessionID: string, memory: SessionMemory) => void
  readonly clear: (sessionID: string) => void
}

type Statement = {
  get: (...params: unknown[]) => unknown
  run: (...params: unknown[]) => unknown
}

type Driver = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
}

const createTable = `
  CREATE TABLE IF NOT EXISTS agent_memory (
    session_id TEXT PRIMARY KEY,
    workdir TEXT NOT NULL,
    objective TEXT NOT NULL,
    scope TEXT NOT NULL,
    phase TEXT NOT NULL,
    completed TEXT NOT NULL,
    evidence TEXT NOT NULL,
    corrections TEXT NOT NULL,
    blocker TEXT,
    next_action TEXT NOT NULL,
    next_check TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  )
`

async function loadDriver(filename: string): Promise<Driver> {
  const specifier = typeof Bun !== "undefined" ? "bun:sqlite" : "node:sqlite"
  const mod: Record<string, unknown> = await import(specifier)
  if (typeof Bun !== "undefined") {
    const Database = mod.default as new (file: string) => {
      exec: (sql: string) => void
      prepare: (sql: string) => Statement
    }
    const db = new Database(filename)
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const statement = db.prepare(sql)
        return {
          get: (...params) => statement.get(...params),
          run: (...params) => statement.run(...params),
        }
      },
    }
  }
  const DatabaseSync = mod.DatabaseSync as new (file: string) => {
    exec: (sql: string) => void
    prepare: (sql: string) => Statement
  }
  const db = new DatabaseSync(filename)
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql)
      return {
        get: (...params) => statement.get(...params),
        run: (...params) => statement.run(...params),
      }
    },
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function requiredText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  return parsed.every((item): item is string => typeof item === "string") ? parsed : undefined
}

function decode(row: unknown): SessionMemory | undefined {
  const input = record(row)
  if (!input) return undefined
  const workdir = typeof input.workdir === "string" ? input.workdir : undefined
  const objective = requiredText(input.objective)
  const scope = requiredText(input.scope)
  const phase = requiredText(input.phase)
  const completed = stringList(input.completed)
  const evidence = stringList(input.evidence)
  const corrections = stringList(input.corrections)
  const nextAction = requiredText(input.next_action)
  const nextCheck = requiredText(input.next_check)
  const blocker = input.blocker === null || input.blocker === undefined ? undefined : requiredText(input.blocker)
  if (workdir === undefined || !objective || !scope || !phase || !completed || !evidence || !corrections || !nextAction || !nextCheck)
    return undefined
  if (input.blocker !== null && input.blocker !== undefined && blocker === undefined) return undefined
  return {
    workdir,
    objective,
    scope,
    phase,
    completed,
    evidence,
    corrections,
    ...(blocker ? { blocker } : {}),
    nextAction,
    nextCheck,
  }
}

export function path(dataDir = Global.Path.data): string {
  return join(dataDir, "ocx", "agent-memory.db")
}

export function open(filename = path()): Effect.Effect<Store, unknown> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => mkdirSync(dirname(filename), { recursive: true, mode: 0o700 }),
      catch: (error) => error,
    })
    const driver = yield* Effect.tryPromise({
      try: () => loadDriver(filename),
      catch: (error) => error,
    })
    driver.exec("PRAGMA busy_timeout = 5000")
    driver.exec("PRAGMA journal_mode = WAL")
    driver.exec(createTable)
    const select = driver.prepare(
      "SELECT workdir, objective, scope, phase, completed, evidence, corrections, blocker, next_action, next_check FROM agent_memory WHERE session_id = ?",
    )
    const upsert = driver.prepare(
      `INSERT INTO agent_memory (session_id, workdir, objective, scope, phase, completed, evidence, corrections, blocker, next_action, next_check, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET workdir = excluded.workdir, objective = excluded.objective, scope = excluded.scope, phase = excluded.phase, completed = excluded.completed, evidence = excluded.evidence, corrections = excluded.corrections, blocker = excluded.blocker, next_action = excluded.next_action, next_check = excluded.next_check, time_updated = excluded.time_updated`,
    )
    const remove = driver.prepare("DELETE FROM agent_memory WHERE session_id = ?")
    return {
      get: (sessionID) => decode(select.get(sessionID)),
      set: (sessionID, memory) => {
        const now = Date.now()
        upsert.run(
          sessionID,
          memory.workdir,
          memory.objective,
          memory.scope,
          memory.phase,
          JSON.stringify(memory.completed),
          JSON.stringify(memory.evidence),
          JSON.stringify(memory.corrections),
          memory.blocker ?? null,
          memory.nextAction,
          memory.nextCheck,
          now,
          now,
        )
      },
      clear: (sessionID) => remove.run(sessionID),
    } satisfies Store
  })
}

export function memory(): Store {
  const rows = new Map<string, SessionMemory>()
  return {
    get: (sessionID) => rows.get(sessionID),
    set: (sessionID, value) => rows.set(sessionID, value),
    clear: (sessionID) => rows.delete(sessionID),
  }
}

const sharedPromises = new Map<string, Promise<Store>>()

export function shared(dataDir = Global.Path.data): Effect.Effect<Store, unknown> {
  const filename = path(dataDir)
  return Effect.tryPromise({
    try: () => {
      const current = sharedPromises.get(filename)
      if (current) return current
      const pending = Effect.runPromise(open(filename)).catch((error) => {
        if (sharedPromises.get(filename) === pending) sharedPromises.delete(filename)
        throw error
      })
      sharedPromises.set(filename, pending)
      return pending
    },
    catch: (error) => error,
  })
}
