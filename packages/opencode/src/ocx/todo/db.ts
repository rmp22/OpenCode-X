import { Effect } from "effect"
import { mkdirSync } from "fs"
import { dirname, join } from "path"
import { Global } from "@opencode-ai/core/global"

export type RunRecord = {
  readonly contextHash: string
  readonly todos: unknown
  readonly notice: string | undefined
}

export interface Store {
  readonly last: (sessionID: string) => RunRecord | undefined
  readonly record: (sessionID: string, run: RunRecord) => void
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
  CREATE TABLE IF NOT EXISTS todo_agent_run (
    session_id TEXT PRIMARY KEY,
    context_hash TEXT NOT NULL,
    todos TEXT NOT NULL,
    notice TEXT,
    time_updated INTEGER NOT NULL
  )
`

async function loadDriver(filename: string): Promise<Driver> {
  const specifier = typeof Bun !== "undefined" ? "bun:sqlite" : "node:sqlite"
  const mod: Record<string, unknown> = await import(specifier)
  if (typeof Bun !== "undefined") {
    const Database = mod.default as new (file: string) => { exec: (sql: string) => void; prepare: (sql: string) => Statement }
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
  const DatabaseSync = mod.DatabaseSync as new (file: string) => { exec: (sql: string) => void; prepare: (sql: string) => Statement }
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

export function path(): string {
  return join(Global.Path.data, "ocx", "todo.db")
}

function decodeRun(row: unknown): RunRecord | undefined {
  if (!row || typeof row !== "object") return undefined
  const record = row as Record<string, unknown>
  if (typeof record.context_hash !== "string" || typeof record.todos !== "string") return undefined
  try {
    return {
      contextHash: record.context_hash,
      todos: JSON.parse(record.todos),
      notice: typeof record.notice === "string" ? record.notice : undefined,
    }
  } catch {
    return undefined
  }
}

export function open(filename = path()): Effect.Effect<Store, unknown> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => mkdirSync(dirname(filename), { recursive: true }),
      catch: (error) => error,
    })
    const driver = yield* Effect.tryPromise({
      try: () => loadDriver(filename),
      catch: (error) => error,
    })
    driver.exec("PRAGMA journal_mode = WAL")
    driver.exec("PRAGMA busy_timeout = 5000")
    driver.exec(createTable)
    const select = driver.prepare("SELECT context_hash, todos, notice FROM todo_agent_run WHERE session_id = ?")
    const upsert = driver.prepare(
      `INSERT INTO todo_agent_run (session_id, context_hash, todos, notice, time_updated)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET context_hash = excluded.context_hash, todos = excluded.todos, notice = excluded.notice, time_updated = excluded.time_updated`,
    )
    return {
      last: (sessionID) => decodeRun(select.get(sessionID)),
      record: (sessionID, run) => {
        upsert.run(sessionID, run.contextHash, JSON.stringify(run.todos), run.notice ?? null, Date.now())
      },
    } satisfies Store
  })
}

export function memory(): Store {
  const rows = new Map<string, RunRecord>()
  return {
    last: (sessionID) => rows.get(sessionID),
    record: (sessionID, run) => rows.set(sessionID, run),
  }
}

let sharedPromise: Promise<Store> | undefined

export const shared: Effect.Effect<Store, unknown> = Effect.tryPromise({
  try: () => {
    if (!sharedPromise) {
      sharedPromise = Effect.runPromise(open()).catch((error) => {
        sharedPromise = undefined
        throw error
      })
    }
    return sharedPromise
  },
  catch: (error) => error,
})
