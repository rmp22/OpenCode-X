import { randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, realpathSync, unlinkSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Provenance } from "../provenance"
import { SecretRedaction } from "../secret-redaction"

export type OwnerStatus = "available" | "busy" | "disabled" | "archived"

export type ScopeType =
  | "directory"
  | "file"
  | "module"
  | "package"
  | "component"
  | "subsystem"
  | "feature"
  | "architecture"
  | "technology"
  | "topic"

export type Scope = {
  readonly type: ScopeType
  readonly value: string
  readonly priority: number
}

export type Owner = {
  readonly id: string
  readonly repositoryID: string
  readonly name: string
  readonly topic: string
  readonly description: string
  readonly status: OwnerStatus
  readonly currentSessionID?: string
  readonly confidence: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastUsedAt?: number
  readonly lastSeenRevision?: string
  readonly lastVerifiedRevision?: string
  readonly isDirty?: boolean
  readonly scopes: readonly Scope[]
}

export type Knowledge = {
  readonly category: string
  readonly key: string
  readonly value: string
  readonly sourceRevision?: string
  readonly source?: Provenance.Source
  readonly sourceRef?: string
  readonly verifiedAt?: number
  readonly updatedAt: number
}

export type OwnerTaskStatus = "queued" | "running" | "needs_input" | "completed" | "failed" | "cancelled"

export type OwnerTask = {
  readonly id: string
  readonly ownerID: string
  readonly primarySessionID: string
  readonly summary: string
  readonly status: OwnerTaskStatus
  readonly startedAt: number
  readonly completedAt?: number
  readonly revisionBefore?: string
  readonly revisionAfter?: string
  readonly resultSummary?: string
}

export type Store = {
  readonly list: (repositoryID: string) => Owner[]
  readonly get: (repositoryID: string, ownerID: string) => Owner | undefined
  readonly create: (input: {
    repositoryID: string
    name: string
    topic: string
    description: string
    scopes: readonly Scope[]
    revision?: string
  }) => Owner
  readonly setStatus: (repositoryID: string, ownerID: string, status: OwnerStatus) => void
  readonly touch: (repositoryID: string, ownerID: string, revision?: string) => void
  readonly attachSession: (repositoryID: string, ownerID: string, sessionID: string) => void
  readonly retireSession: (repositoryID: string, ownerID: string, sessionID: string, reason: string) => void
  readonly knowledge: (repositoryID: string, ownerID: string) => Knowledge[]
  readonly repositoryKnowledge: (repositoryID: string) => Knowledge[]
  readonly setKnowledge: (input: {
    repositoryID: string
    ownerID: string
    category: string
    key: string
    value: string
    sourceRevision?: string
    source?: Provenance.Source
    sourceRef?: string
    verifiedAt?: number
  }) => void
  readonly setRepositoryKnowledge: (input: {
    repositoryID: string
    category: string
    key: string
    value: string
    sourceRevision?: string
    source?: Provenance.Source
    sourceRef?: string
    verifiedAt?: number
  }) => void
  readonly tasks: (ownerID: string) => OwnerTask[]
  readonly recordTask: (input: Omit<OwnerTask, "id"> & { id?: string }) => OwnerTask
  readonly acquire: (ownerID: string, leaseID: string, ttlMs: number) => boolean
  readonly release: (ownerID: string, leaseID: string) => void
}

type Statement = {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => unknown
}

type Driver = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
}

type OwnerRow = Record<string, unknown>
type Locator = {
  readonly sessionID: (repositoryID: string, requestedSessionID: string) => string
}

const stores = new Map<string, Promise<Store>>()
let locator: Promise<Locator> | undefined
const SQLITE_FILE_SUFFIXES = ["", "-wal", "-shm"] as const

const schema = `
  CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    name TEXT NOT NULL,
    topic TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    current_session_id TEXT,
    confidence REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER,
    last_seen_revision TEXT
  );
  CREATE INDEX IF NOT EXISTS owners_repository_idx ON owners(repository_id, status, updated_at);
  CREATE TABLE IF NOT EXISTS owner_scopes (
    owner_id TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_value TEXT NOT NULL,
    priority INTEGER NOT NULL,
    PRIMARY KEY(owner_id, scope_type, scope_value)
  );
  CREATE TABLE IF NOT EXISTS owner_sessions (
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    active INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    retired_at INTEGER,
    retirement_reason TEXT,
    PRIMARY KEY(owner_id, session_id)
  );
  CREATE INDEX IF NOT EXISTS owner_sessions_active_idx ON owner_sessions(owner_id, active);
  CREATE TABLE IF NOT EXISTS owner_knowledge (
    owner_id TEXT NOT NULL,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source_revision TEXT,
    source TEXT,
    source_ref TEXT,
    verified_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner_id, category, key)
  );
  CREATE TABLE IF NOT EXISTS repository_knowledge (
    repository_id TEXT NOT NULL,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source_revision TEXT,
    source TEXT,
    source_ref TEXT,
    verified_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(repository_id, category, key)
  );
  CREATE TABLE IF NOT EXISTS owner_tasks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    primary_session_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    revision_before TEXT,
    revision_after TEXT,
    result_summary TEXT
  );
  CREATE TABLE IF NOT EXISTS owner_leases (
    owner_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`

function ownerPath(sessionID: string): string {
  return join(Global.Path.data, "ocx", "owners", encodeURIComponent(sessionID || "unknown"), "owners.db")
}

function legacyPaths(workdir: string): string[] {
  const root = resolve(workdir)
  return [join(root, ".ocx", "owners.db"), join(root, ".opencode-x", "owners.db")]
}

function removeDatabaseFiles(filename: string): void {
  for (const suffix of SQLITE_FILE_SUFFIXES) {
    const path = `${filename}${suffix}`
    if (!existsSync(path)) continue
    try {
      unlinkSync(path)
    } catch {}
  }
}

function migrateLegacyDatabase(workdir: string, target: string): string | undefined {
  if (existsSync(target)) return undefined
  const source = legacyPaths(workdir).find((path) => existsSync(path))
  if (!source) return undefined
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const copied: string[] = []
  try {
    for (const suffix of SQLITE_FILE_SUFFIXES) {
      const sourceFile = `${source}${suffix}`
      if (!existsSync(sourceFile)) continue
      const targetFile = `${target}${suffix}`
      copyFileSync(sourceFile, targetFile)
      copied.push(targetFile)
    }
    return source
  } catch (error) {
    for (const path of copied) {
      try {
        unlinkSync(path)
      } catch {}
    }
    throw error
  }
}

export function filePath(sessionID: string): string {
  return ownerPath(sessionID)
}

export function repositoryID(workdir: string): string {
  try {
    return realpathSync(resolve(workdir))
  } catch {
    return resolve(workdir)
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function ownerStatus(value: unknown): OwnerStatus {
  return value === "busy" || value === "disabled" || value === "archived" ? value : "available"
}

function scopeType(value: unknown): ScopeType | undefined {
  if (
    value === "directory" ||
    value === "file" ||
    value === "module" ||
    value === "package" ||
    value === "component" ||
    value === "subsystem" ||
    value === "feature" ||
    value === "architecture" ||
    value === "technology" ||
    value === "topic"
  )
    return value
  return undefined
}

function decodeScopes(rows: unknown[]): Scope[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return []
    const item = row as OwnerRow
    const type = scopeType(item.scope_type)
    const value = text(item.scope_value)
    const priority = number(item.priority)
    return type && value && priority !== undefined ? [{ type, value, priority }] : []
  })
}

function decodeOwner(row: unknown, scopes: readonly Scope[] = []): Owner | undefined {
  if (!row || typeof row !== "object") return undefined
  const item = row as OwnerRow
  const id = text(item.id)
  const repositoryID = text(item.repository_id)
  const name = text(item.name)
  const topic = text(item.topic)
  const description = text(item.description)
  const confidence = number(item.confidence)
  const createdAt = number(item.created_at)
  const updatedAt = number(item.updated_at)
  if (!id || !repositoryID || !name || !topic || !description || confidence === undefined || createdAt === undefined || updatedAt === undefined)
    return undefined
  const currentSessionID = text(item.current_session_id)
  const lastUsedAt = number(item.last_used_at)
  const lastSeenRevision = text(item.last_seen_revision)
  return {
    id,
    repositoryID,
    name,
    topic,
    description,
    status: ownerStatus(item.status),
    ...(currentSessionID ? { currentSessionID } : {}),
    confidence,
    createdAt,
    updatedAt,
    ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
    ...(lastSeenRevision ? { lastSeenRevision } : {}),
    scopes: [...scopes],
  }
}

function decodeKnowledge(row: unknown): Knowledge | undefined {
  if (!row || typeof row !== "object") return undefined
  const item = row as OwnerRow
  const category = text(item.category)
  const key = text(item.key)
  const value = text(item.value)
  const updatedAt = number(item.updated_at)
  if (!category || !key || !value || updatedAt === undefined) return undefined
  const sourceRevision = text(item.source_revision)
  const source = Provenance.parseSource(item.source)
  const sourceRef = Provenance.reference(item.source_ref)
  const verifiedAt = number(item.verified_at)
  return {
    category,
    key,
    value,
    updatedAt,
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(source ? { source } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...(verifiedAt !== undefined ? { verifiedAt } : {}),
  }
}

function ensureColumn(driver: Driver, table: string, name: string, definition: string): void {
  const columns = driver.prepare(`PRAGMA table_info(${table})`).all() as OwnerRow[]
  if (!columns.some((column) => column.name === name)) driver.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

function taskStatus(value: unknown): OwnerTask["status"] | undefined {
  if (value === "queued" || value === "running" || value === "needs_input" || value === "completed" || value === "failed" || value === "cancelled") return value
  return undefined
}

function decodeTask(row: unknown): OwnerTask | undefined {
  if (!row || typeof row !== "object") return undefined
  const item = row as OwnerRow
  const id = text(item.id)
  const ownerID = text(item.owner_id)
  const primarySessionID = text(item.primary_session_id)
  const summary = text(item.summary)
  const status = taskStatus(item.status)
  const startedAt = number(item.started_at)
  if (!id || !ownerID || !primarySessionID || !summary || !status || startedAt === undefined) return undefined
  const completedAt = number(item.completed_at)
  const revisionBefore = text(item.revision_before)
  const revisionAfter = text(item.revision_after)
  const resultSummary = text(item.result_summary)
  return {
    id,
    ownerID,
    primarySessionID,
    summary,
    status,
    startedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(revisionBefore ? { revisionBefore } : {}),
    ...(revisionAfter ? { revisionAfter } : {}),
    ...(resultSummary ? { resultSummary } : {}),
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
    return { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) }
  }
  const DatabaseSync = mod.DatabaseSync as new (file: string) => {
    exec: (sql: string) => void
    prepare: (sql: string) => Statement
  }
  const db = new DatabaseSync(filename)
  return { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql) }
}

async function openLocator(): Promise<Locator> {
  const filename = join(Global.Path.data, "ocx", "owners", "index.db")
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const driver = await loadDriver(filename)
  driver.exec("PRAGMA journal_mode = WAL")
  driver.exec("PRAGMA busy_timeout = 5000")
  driver.exec(`
    CREATE TABLE IF NOT EXISTS owner_repositories (
      repository_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    )
  `)
  const select = driver.prepare("SELECT session_id FROM owner_repositories WHERE repository_id = ?")
  const insert = driver.prepare("INSERT OR IGNORE INTO owner_repositories (repository_id, session_id) VALUES (?, ?)")
  return {
    sessionID: (repositoryID, requestedSessionID) => {
      const existing = select.get(repositoryID)
      if (existing && typeof existing === "object") {
        const sessionID = text((existing as OwnerRow).session_id)
        if (sessionID) return sessionID
      }
      insert.run(repositoryID, requestedSessionID)
      const assigned = select.get(repositoryID)
      return assigned && typeof assigned === "object"
        ? (text((assigned as OwnerRow).session_id) ?? requestedSessionID)
        : requestedSessionID
    },
  }
}

function ownerDatabasePath(workdir: string, requestedSessionID: string): Promise<string> {
  const repository = repositoryID(workdir)
  if (!locator) {
    locator = openLocator().catch((error) => {
      locator = undefined
      throw error
    })
  }
  return locator.then((value) => filePath(value.sessionID(repository, requestedSessionID)))
}

async function openStore(filename: string): Promise<Store> {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const driver = await loadDriver(filename)
  driver.exec("PRAGMA journal_mode = WAL")
  driver.exec("PRAGMA busy_timeout = 5000")
  driver.exec(schema)
  for (const table of ["owner_knowledge", "repository_knowledge"]) {
    ensureColumn(driver, table, "source", "TEXT")
    ensureColumn(driver, table, "source_ref", "TEXT")
    ensureColumn(driver, table, "verified_at", "INTEGER")
  }

  const ownerRows = driver.prepare("SELECT * FROM owners WHERE repository_id = ? ORDER BY updated_at DESC, id ASC")
  const ownerRow = driver.prepare("SELECT * FROM owners WHERE repository_id = ? AND id = ?")
  const scopeRows = driver.prepare("SELECT scope_type, scope_value, priority FROM owner_scopes WHERE owner_id = ? ORDER BY priority DESC, scope_value ASC")
  const insertOwner = driver.prepare(
    "INSERT INTO owners (id, repository_id, name, topic, description, status, confidence, created_at, updated_at, last_used_at, last_seen_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  const insertScope = driver.prepare(
    "INSERT OR REPLACE INTO owner_scopes (owner_id, scope_type, scope_value, priority) VALUES (?, ?, ?, ?)",
  )
  const updateStatus = driver.prepare("UPDATE owners SET status = ?, updated_at = ? WHERE repository_id = ? AND id = ?")
  const touchOwner = driver.prepare(
    "UPDATE owners SET updated_at = ?, last_used_at = ?, last_seen_revision = COALESCE(?, last_seen_revision) WHERE repository_id = ? AND id = ?",
  )
  const currentSession = driver.prepare("SELECT session_id FROM owner_sessions WHERE owner_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1")
  const deactivateSessions = driver.prepare("UPDATE owner_sessions SET active = 0, retired_at = ?, retirement_reason = ? WHERE owner_id = ? AND active = 1")
  const insertSession = driver.prepare(
    "INSERT OR REPLACE INTO owner_sessions (owner_id, session_id, active, created_at, retired_at, retirement_reason) VALUES (?, ?, 1, ?, NULL, NULL)",
  )
  const retireSession = driver.prepare(
    "UPDATE owner_sessions SET active = 0, retired_at = ?, retirement_reason = ? WHERE owner_id = ? AND session_id = ?",
  )
  const knowledgeRows = driver.prepare("SELECT category, key, value, source_revision, source, source_ref, verified_at, updated_at FROM owner_knowledge WHERE owner_id = ? ORDER BY updated_at DESC, category ASC, key ASC")
  const repositoryKnowledgeRows = driver.prepare("SELECT category, key, value, source_revision, source, source_ref, verified_at, updated_at FROM repository_knowledge WHERE repository_id = ? ORDER BY updated_at DESC, category ASC, key ASC")
  const taskRows = driver.prepare("SELECT id, owner_id, primary_session_id, summary, status, started_at, completed_at, revision_before, revision_after, result_summary FROM owner_tasks WHERE owner_id = ? ORDER BY started_at ASC, id ASC")
  const upsertKnowledge = driver.prepare(
    "INSERT INTO owner_knowledge (owner_id, category, key, value, source_revision, source, source_ref, verified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, category, key) DO UPDATE SET value = excluded.value, source_revision = excluded.source_revision, source = excluded.source, source_ref = excluded.source_ref, verified_at = excluded.verified_at, updated_at = excluded.updated_at",
  )
  const upsertRepositoryKnowledge = driver.prepare(
    "INSERT INTO repository_knowledge (repository_id, category, key, value, source_revision, source, source_ref, verified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(repository_id, category, key) DO UPDATE SET value = excluded.value, source_revision = excluded.source_revision, source = excluded.source, source_ref = excluded.source_ref, verified_at = excluded.verified_at, updated_at = excluded.updated_at",
  )
  const insertTask = driver.prepare(
    "INSERT OR REPLACE INTO owner_tasks (id, owner_id, primary_session_id, summary, status, started_at, completed_at, revision_before, revision_after, result_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  const leaseRow = driver.prepare("SELECT lease_id, expires_at FROM owner_leases WHERE owner_id = ?")
  const upsertLease = driver.prepare(
    "INSERT INTO owner_leases (owner_id, lease_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET lease_id = excluded.lease_id, expires_at = excluded.expires_at",
  )
  const deleteLease = driver.prepare("DELETE FROM owner_leases WHERE owner_id = ? AND lease_id = ?")

  const get = (repositoryID: string, ownerID: string) => {
    const row = ownerRow.get(repositoryID, ownerID)
    const owner = decodeOwner(row, decodeScopes(scopeRows.all(ownerID)))
    if (!owner) return undefined
    const active = currentSession.get(ownerID)
    const sessionID = active && typeof active === "object" ? text((active as OwnerRow).session_id) : undefined
    return sessionID ? { ...owner, currentSessionID: sessionID } : owner
  }

  return {
    list: (repositoryID) =>
      ownerRows.all(repositoryID).flatMap((row) => {
        const owner = decodeOwner(row, decodeScopes(scopeRows.all((row as OwnerRow).id)))
        if (!owner) return []
        const active = currentSession.get(owner.id)
        const sessionID = active && typeof active === "object" ? text((active as OwnerRow).session_id) : undefined
        return [sessionID ? { ...owner, currentSessionID: sessionID } : owner]
      }),
    get,
    create: (input) => {
      const now = Date.now()
      const id = `owner_${randomUUID().replaceAll("-", "")}`
      insertOwner.run(
        id,
        input.repositoryID,
        input.name,
        input.topic,
        input.description,
        "available",
        0.5,
        now,
        now,
        null,
        input.revision ?? null,
      )
      for (const scope of input.scopes) insertScope.run(id, scope.type, scope.value, scope.priority)
      return get(input.repositoryID, id)!
    },
    setStatus: (repositoryID, ownerID, status) => updateStatus.run(status, Date.now(), repositoryID, ownerID),
    touch: (repositoryID, ownerID, revision) => touchOwner.run(Date.now(), Date.now(), revision ?? null, repositoryID, ownerID),
    attachSession: (repositoryID, ownerID, sessionID) => {
      const now = Date.now()
      driver.exec("BEGIN IMMEDIATE")
      try {
        deactivateSessions.run(now, "replaced", ownerID)
        insertSession.run(ownerID, sessionID, now)
        touchOwner.run(now, now, null, repositoryID, ownerID)
        driver.exec("COMMIT")
      } catch (error) {
        try {
          driver.exec("ROLLBACK")
        } catch {}
        throw error
      }
    },
    retireSession: (repositoryID, ownerID, sessionID, reason) => {
      const now = Date.now()
      retireSession.run(now, reason, ownerID, sessionID)
      touchOwner.run(now, now, null, repositoryID, ownerID)
    },
    knowledge: (repositoryID, ownerID) => {
      if (!get(repositoryID, ownerID)) return []
      return knowledgeRows.all(ownerID).flatMap((row) => {
        const item = decodeKnowledge(row)
        return item ? [item] : []
      })
    },
    repositoryKnowledge: (repositoryID) => repositoryKnowledgeRows.all(repositoryID).flatMap((row) => {
      const item = decodeKnowledge(row)
      return item ? [item] : []
    }),
    setKnowledge: (input) => {
      if (!get(input.repositoryID, input.ownerID)) return
      const safe = SecretRedaction.redact(input.value)
      upsertKnowledge.run(
        input.ownerID,
        input.category,
        input.key,
        safe.value,
        input.sourceRevision ?? null,
        input.source ?? null,
        Provenance.reference(input.sourceRef) ?? null,
        input.verifiedAt ?? null,
        Date.now(),
      )
    },
    setRepositoryKnowledge: (input) => {
      const safe = SecretRedaction.redact(input.value)
      upsertRepositoryKnowledge.run(
        input.repositoryID,
        input.category,
        input.key,
        safe.value,
        input.sourceRevision ?? null,
        input.source ?? null,
        Provenance.reference(input.sourceRef) ?? null,
        input.verifiedAt ?? null,
        Date.now(),
      )
    },
    tasks: (ownerID) => taskRows.all(ownerID).flatMap((row) => {
      const task = decodeTask(row)
      return task ? [task] : []
    }),
    recordTask: (input) => {
      const task = {
        ...input,
        id: input.id ?? `owner_task_${randomUUID().replaceAll("-", "")}`,
      }
      insertTask.run(
        task.id,
        task.ownerID,
        task.primarySessionID,
        task.summary,
        task.status,
        task.startedAt,
        task.completedAt ?? null,
        task.revisionBefore ?? null,
        task.revisionAfter ?? null,
        task.resultSummary ?? null,
      )
      return task
    },
    acquire: (ownerID, leaseID, ttlMs) => {
      const now = Date.now()
      driver.exec("BEGIN IMMEDIATE")
      try {
        const existing = leaseRow.get(ownerID)
        if (existing && typeof existing === "object") {
          const row = existing as OwnerRow
          const activeID = text(row.lease_id)
          const expiresAt = number(row.expires_at) ?? 0
          if (activeID && activeID !== leaseID && expiresAt > now) {
            driver.exec("COMMIT")
            return false
          }
        }
        upsertLease.run(ownerID, leaseID, now + Math.max(1_000, ttlMs))
        driver.exec("COMMIT")
        return true
      } catch (error) {
        try {
          driver.exec("ROLLBACK")
        } catch {}
        throw error
      }
    },
    release: (ownerID, leaseID) => deleteLease.run(ownerID, leaseID),
  }
}

export function open(workdir: string, sessionID: string): Effect.Effect<Store, unknown> {
  return Effect.tryPromise({
    try: async () => {
      const filename = await ownerDatabasePath(workdir, sessionID)
      const legacy = migrateLegacyDatabase(workdir, filename)
      let pending = stores.get(filename)
      if (!pending) {
        pending = openStore(filename)
          .then((store) => {
            if (legacy) removeDatabaseFiles(legacy)
            return store
          })
          .catch((error) => {
            stores.delete(filename)
            if (legacy) removeDatabaseFiles(filename)
            throw error
          })
        stores.set(filename, pending)
      }
      return pending
    },
    catch: (error) => error,
  })
}

export function memory(): Store {
  const owners = new Map<string, Owner>()
  const knowledge = new Map<string, Knowledge[]>()
  const repositoryKnowledge = new Map<string, Knowledge[]>()
  const tasks: OwnerTask[] = []
  const leases = new Map<string, { leaseID: string; expiresAt: number }>()
  return {
    list: (repositoryID) => [...owners.values()].filter((owner) => owner.repositoryID === repositoryID),
    get: (repositoryID, ownerID) => {
      const owner = owners.get(ownerID)
      return owner?.repositoryID === repositoryID ? owner : undefined
    },
    create: (input) => {
      const now = Date.now()
      const owner: Owner = {
        id: `owner_${randomUUID().replaceAll("-", "")}`,
        repositoryID: input.repositoryID,
        name: input.name,
        topic: input.topic,
        description: input.description,
        status: "available",
        confidence: 0.5,
        createdAt: now,
        updatedAt: now,
        ...(input.revision ? { lastSeenRevision: input.revision } : {}),
        scopes: [...input.scopes],
      }
      owners.set(owner.id, owner)
      return owner
    },
    setStatus: (_repositoryID, ownerID, status) => {
      const owner = owners.get(ownerID)
      if (owner) owners.set(ownerID, { ...owner, status, updatedAt: Date.now() })
    },
    touch: (_repositoryID, ownerID, revision) => {
      const owner = owners.get(ownerID)
      if (owner) owners.set(ownerID, { ...owner, updatedAt: Date.now(), lastUsedAt: Date.now(), ...(revision ? { lastSeenRevision: revision } : {}) })
    },
    attachSession: (_repositoryID, ownerID, sessionID) => {
      const owner = owners.get(ownerID)
      if (owner) owners.set(ownerID, { ...owner, currentSessionID: sessionID, updatedAt: Date.now(), lastUsedAt: Date.now() })
    },
    retireSession: () => {},
    knowledge: (_repositoryID, ownerID) => [...(knowledge.get(ownerID) ?? [])],
    repositoryKnowledge: (repositoryID) => [...(repositoryKnowledge.get(repositoryID) ?? [])],
    setKnowledge: (input) => {
      const current = knowledge.get(input.ownerID) ?? []
      const next = current.filter((item) => item.category !== input.category || item.key !== input.key)
      const safe = SecretRedaction.redact(input.value)
      next.push({
        category: input.category,
        key: input.key,
        value: safe.value,
        updatedAt: Date.now(),
        ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(Provenance.reference(input.sourceRef) ? { sourceRef: Provenance.reference(input.sourceRef) } : {}),
        ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
      })
      knowledge.set(input.ownerID, next)
    },
    setRepositoryKnowledge: (input) => {
      const current = repositoryKnowledge.get(input.repositoryID) ?? []
      const next = current.filter((item) => item.category !== input.category || item.key !== input.key)
      const safe = SecretRedaction.redact(input.value)
      next.push({
        category: input.category,
        key: input.key,
        value: safe.value,
        updatedAt: Date.now(),
        ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(Provenance.reference(input.sourceRef) ? { sourceRef: Provenance.reference(input.sourceRef) } : {}),
        ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
      })
      repositoryKnowledge.set(input.repositoryID, next)
    },
    tasks: (ownerID) => tasks.filter((task) => task.ownerID === ownerID),
    recordTask: (input) => {
      const task = { ...input, id: input.id ?? `owner_task_${randomUUID().replaceAll("-", "")}` }
      const index = tasks.findIndex((item) => item.id === task.id)
      if (index >= 0) tasks[index] = task
      else tasks.push(task)
      return task
    },
    acquire: (ownerID, leaseID, ttlMs) => {
      const current = leases.get(ownerID)
      const now = Date.now()
      if (current && current.leaseID !== leaseID && current.expiresAt > now) return false
      leases.set(ownerID, { leaseID, expiresAt: now + Math.max(1_000, ttlMs) })
      return true
    },
    release: (ownerID, leaseID) => {
      if (leases.get(ownerID)?.leaseID === leaseID) leases.delete(ownerID)
    },
  }
}

export * as OwnerRegistry from "./registry"
