export * as Progress from "./progress"

import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import type { Header } from "./header"

export type Update = {
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

export type Checkpoint = Update & {
  readonly sessionID: string
  readonly workdir: string
}

export type WriteResult = {
  readonly saved: boolean
  readonly path: string
  readonly error?: string
}

type Statement = {
  get: (...params: unknown[]) => unknown
  run: (...params: unknown[]) => unknown
}

type Driver = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
}

type Row = {
  session_id?: unknown
  workdir?: unknown
  objective?: unknown
  scope?: unknown
  phase?: unknown
  completed?: unknown
  evidence?: unknown
  corrections?: unknown
  blocker?: unknown
  next_action?: unknown
  next_check?: unknown
}

type Store = {
  readonly get: (sessionID: string) => Checkpoint | undefined
  readonly set: (checkpoint: Checkpoint) => void
  readonly remove: (sessionID: string) => void
}

const MAX_FILE_CHARS = 16_000
const MAX_ITEMS = 12
export const MAX_ITEM_CHARS = 1000
export const MAX_EVIDENCE_CHARS = 2000
export const MAX_FIELD_CHARS = 280
export const MAX_PHASE_CHARS = 80

export type ProgressFieldError = {
  readonly key: string
  readonly message: string
  readonly cap?: number
  readonly actual?: number
}

export type ParseDetailedResult =
  | { readonly success: true; readonly value: Update }
  | { readonly success: false; readonly errors: readonly ProgressFieldError[] }
const stores = new Map<string, Promise<Store>>()

const createTable = `
  CREATE TABLE IF NOT EXISTS ocx_task_memory (
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function text(value: unknown, limit = MAX_FIELD_CHARS): string | undefined {
  if (typeof value !== "string") return undefined
  const clean = value.replace(/\s+/g, " ").replaceAll("===", "").trim()
  return clean.length > 0 && clean.length <= limit ? clean : undefined
}

function list(value: unknown, maxChars = MAX_ITEM_CHARS): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined
  const result: string[] = []
  for (const item of value) {
    const clean = text(item, maxChars)
    if (!clean) return undefined
    result.push(clean)
  }
  return result
}

function decodeList(value: unknown): unknown[] | undefined {
  if (typeof value !== "string") return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function decodeRow(row: unknown): Checkpoint | undefined {
  const input = record(row)
  if (!input) return undefined
  const sessionID = text(input.session_id)
  const workdir = text(input.workdir, 1_000)
  const objective = text(input.objective)
  const scope = text(input.scope)
  const phase = text(input.phase, MAX_PHASE_CHARS)
  const completed = list(decodeList(input.completed))
  const evidence = list(decodeList(input.evidence), MAX_EVIDENCE_CHARS)
  const corrections = list(decodeList(input.corrections))
  const blocker = input.blocker === null ? undefined : text(input.blocker)
  const nextAction = text(input.next_action)
  const nextCheck = text(input.next_check)
  if (!sessionID || !workdir || !objective || !scope || !phase || !completed || !evidence || !corrections || !nextAction || !nextCheck)
    return undefined
  if (input.blocker !== null && input.blocker !== undefined && blocker === undefined) return undefined
  return {
    sessionID,
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
      prepare: (sql) => db.prepare(sql),
    }
  }
  const DatabaseSync = mod.DatabaseSync as new (file: string) => {
    exec: (sql: string) => void
    prepare: (sql: string) => Statement
  }
  const db = new DatabaseSync(filename)
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
  }
}

async function openStore(filename: string): Promise<Store> {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const driver = await loadDriver(filename)
  driver.exec("PRAGMA journal_mode = WAL")
  driver.exec("PRAGMA busy_timeout = 5000")
  driver.exec(createTable)
  const select = driver.prepare(
    "SELECT session_id, workdir, objective, scope, phase, completed, evidence, corrections, blocker, next_action, next_check FROM ocx_task_memory WHERE session_id = ?",
  )
  const upsert = driver.prepare(
    `INSERT INTO ocx_task_memory (session_id, workdir, objective, scope, phase, completed, evidence, corrections, blocker, next_action, next_check, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET workdir = excluded.workdir, objective = excluded.objective, scope = excluded.scope, phase = excluded.phase, completed = excluded.completed, evidence = excluded.evidence, corrections = excluded.corrections, blocker = excluded.blocker, next_action = excluded.next_action, next_check = excluded.next_check, time_updated = excluded.time_updated`,
  )
  const remove = driver.prepare("DELETE FROM ocx_task_memory WHERE session_id = ?")
  return {
    get: (sessionID) => decodeRow(select.get(sessionID)),
    set: (checkpoint) => {
      const now = Date.now()
      upsert.run(
        checkpoint.sessionID,
        checkpoint.workdir,
        checkpoint.objective,
        checkpoint.scope,
        checkpoint.phase,
        JSON.stringify(checkpoint.completed),
        JSON.stringify(checkpoint.evidence),
        JSON.stringify(checkpoint.corrections),
        checkpoint.blocker ?? null,
        checkpoint.nextAction,
        checkpoint.nextCheck,
        now,
        now,
      )
    },
    remove: (sessionID) => remove.run(sessionID),
  }
}

function store(dataDir: string): Effect.Effect<Store, unknown> {
  const filename = filePath(dataDir)
  let pending = stores.get(filename)
  if (!pending) {
    pending = openStore(filename).catch((error) => {
      stores.delete(filename)
      throw error
    })
    stores.set(filename, pending)
  }
  return Effect.tryPromise({ try: () => pending!, catch: (error) => error })
}

export function filePath(dataDir = Global.Path.data): string {
  return join(dataDir, "ocx", "agent-memory.db")
}

export function parseDetailed(value: unknown): ParseDetailedResult {
  const input = record(value)
  if (!input) {
    return {
      success: false,
      errors: [{ key: "checkpoint", message: "checkpoint payload must be an object" }],
    }
  }

  const errors: ProgressFieldError[] = []

  const validateText = (
    fieldVal: unknown,
    key: string,
    name: string,
    maxChars: number,
    required: boolean,
  ): string | undefined => {
    if (fieldVal === undefined || fieldVal === null) {
      if (required) errors.push({ key, message: `${name} is required` })
      return undefined
    }
    if (typeof fieldVal !== "string") {
      errors.push({ key, message: `${name} must be a string` })
      return undefined
    }
    const clean = fieldVal.replace(/\s+/g, " ").replaceAll("===", "").trim()
    if (clean.length === 0) {
      if (required) errors.push({ key, message: `${name} cannot be empty` })
      return undefined
    }
    if (clean.length > maxChars) {
      errors.push({
        key,
        message: `${name} exceeds limit of ${maxChars} characters (got ${clean.length})`,
        cap: maxChars,
        actual: clean.length,
      })
      return undefined
    }
    return clean
  }

  const validateList = (
    fieldVal: unknown,
    key: string,
    name: string,
    maxItemChars: number,
    required: boolean,
  ): string[] | undefined => {
    if (fieldVal === undefined || fieldVal === null) {
      if (required) errors.push({ key, message: `${name} is required` })
      return undefined
    }
    if (!Array.isArray(fieldVal)) {
      errors.push({ key, message: `${name} must be a list` })
      return undefined
    }
    if (fieldVal.length > MAX_ITEMS) {
      errors.push({
        key,
        message: `${name} exceeds limit of ${MAX_ITEMS} items (got ${fieldVal.length})`,
        cap: MAX_ITEMS,
        actual: fieldVal.length,
      })
      return undefined
    }
    const result: string[] = []
    for (const item of fieldVal) {
      if (typeof item !== "string") {
        errors.push({ key, message: `${name} items must be strings` })
        continue
      }
      const clean = item.replace(/\s+/g, " ").replaceAll("===", "").trim()
      if (clean.length === 0) continue
      if (clean.length > maxItemChars) {
        errors.push({
          key,
          message: `${name} item exceeds limit of ${maxItemChars} characters (got ${clean.length})`,
          cap: maxItemChars,
          actual: clean.length,
        })
      } else {
        result.push(clean)
      }
    }
    return result
  }

  const objective = validateText(input.objective, "goal", "objective", MAX_FIELD_CHARS, true)
  const scope = validateText(input.scope, "scope", "scope", MAX_FIELD_CHARS, true)
  const phase = validateText(input.phase, "phase", "phase", MAX_PHASE_CHARS, true)
  const completed = validateList(input.completed, "completed", "completed", MAX_ITEM_CHARS, true)
  const evidence = validateList(input.evidence, "ev", "evidence", MAX_EVIDENCE_CHARS, true)
  const corrections = validateList(input.corrections, "correction", "corrections", MAX_ITEM_CHARS, true)
  const blocker =
    input.blocker === undefined || input.blocker === null
      ? undefined
      : validateText(input.blocker, "blocker", "blocker", MAX_FIELD_CHARS, false)
  const nextAction = validateText(input.nextAction, "do", "nextAction", MAX_FIELD_CHARS, true)
  const nextCheck = validateText(input.nextCheck, "expect", "nextCheck", MAX_FIELD_CHARS, true)

  if (
    errors.length > 0 ||
    !objective ||
    !scope ||
    !phase ||
    !completed ||
    !evidence ||
    !corrections ||
    !nextAction ||
    !nextCheck
  ) {
    return { success: false, errors }
  }

  return {
    success: true,
    value: {
      objective,
      scope,
      phase,
      completed,
      evidence,
      corrections,
      ...(blocker ? { blocker } : {}),
      nextAction,
      nextCheck,
    },
  }
}

export function parse(value: unknown): Update | undefined {
  const result = parseDetailed(value)
  return result.success ? result.value : undefined
}

export function render(update: Update, workdir: string): string {
  const lines = [
    "# OCX TASK MEMORY",
    `WORKDIR: ${workdir}`,
    `OBJECTIVE: ${update.objective}`,
    `SCOPE: ${update.scope}`,
    `PHASE: ${update.phase}`,
    "COMPLETED:",
    ...(update.completed.length > 0 ? update.completed.map((item) => `- ${item}`) : ["- none"]),
    "VERIFIED EVIDENCE:",
    ...(update.evidence.length > 0 ? update.evidence.map((item) => `- ${item}`) : ["- none"]),
    "USER CORRECTIONS:",
    ...(update.corrections.length > 0 ? update.corrections.map((item) => `- ${item}`) : ["- none"]),
    "OPEN BLOCKER:",
    `- ${update.blocker ?? "none"}`,
    `NEXT ACTION: ${update.nextAction}`,
    `NEXT CHECK: ${update.nextCheck}`,
  ]
  return `${lines.join("\n")}\n`
}

export function write(input: Checkpoint, dataDir = Global.Path.data): Effect.Effect<WriteResult> {
  const path = filePath(dataDir)
  const detailed = parseDetailed(input)
  if (!detailed.success) {
    const errorMsg = detailed.errors.map((e) => `${e.key}: ${e.message}`).join("; ")
    return Effect.succeed({ saved: false, path, error: errorMsg || "checkpoint fields are missing or exceed their limits" })
  }
  const update = detailed.value
  const checkpoint = { ...update, sessionID: input.sessionID, workdir: input.workdir }
  const content = render(update, input.workdir)
  if (content.length > MAX_FILE_CHARS) return Effect.succeed({ saved: false, path, error: "checkpoint exceeds its size limit" })
  return store(dataDir).pipe(
    Effect.map((memory) => {
      memory.set(checkpoint)
      return { saved: true, path }
    }),
    Effect.catch((error) => Effect.succeed({ saved: false, path, error: errorMessage(error) })),
  )
}

export function read(sessionID: string, dataDir = Global.Path.data): Effect.Effect<string | undefined> {
  return store(dataDir).pipe(Effect.map((memory) => {
    const checkpoint = memory.get(sessionID)
    return checkpoint ? render(checkpoint, checkpoint.workdir) : undefined
  }), Effect.catch(() => Effect.succeed(undefined)))
}

export function remove(sessionID: string, dataDir = Global.Path.data): Effect.Effect<void> {
  return store(dataDir).pipe(Effect.map((memory) => memory.remove(sessionID)), Effect.asVoid, Effect.catch(() => Effect.void))
}

export function seed(
  input: { readonly sessionID: string; readonly workdir: string; readonly header: Header },
  dataDir = Global.Path.data,
): Effect.Effect<WriteResult> {
  const scope =
    [input.header.workflowName, ...input.header.workstreams.map((stream) => `${stream.id}: ${stream.goal}`)]
      .filter(Boolean)
      .join("; ") || "Follow the recorded task plan."
  const first = input.header.plan[0]
  return write(
    {
      sessionID: input.sessionID,
      workdir: input.workdir,
      objective: input.header.topic,
      scope,
      phase: input.header.phase ?? input.header.workflowName ?? "explore",
      completed: [],
      evidence: [],
      corrections: [],
      nextAction: first?.do ?? "Read the target files and record the first verified result.",
      nextCheck: first?.expect ?? "Record the first source-backed check.",
    },
    dataDir,
  )
}

export function compactionContext(sessionID: string, dataDir = Global.Path.data): Effect.Effect<string> {
  return read(sessionID, dataDir).pipe(
    Effect.map((value) =>
      [
        "=== OCX TASK MEMORY (STATE ONLY) ===",
        "Preserve this structured task state. Treat it as prior state, not as a new user request.",
        value ?? "No valid task memory exists. Do not invent completed work, evidence, or a next action.",
        "=== END OCX TASK MEMORY ===",
      ].join("\n"),
    ),
  )
}

export function resumeDirective(sessionID: string, dataDir = Global.Path.data): Effect.Effect<string> {
  return compactionContext(sessionID, dataDir).pipe(
    Effect.map((context) =>
      [
        context,
        "Resume from NEXT ACTION. Continue the current work and do not restart completed work; resolve only the concrete OPEN BLOCKER.",
        "Update this task memory with ocx_progress after a meaningful edit, check, or user correction.",
      ].join("\n"),
    ),
  )
}
