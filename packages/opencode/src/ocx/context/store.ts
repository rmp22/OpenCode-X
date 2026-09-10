export * as ContextStore from "./store"

import {
  closeSync,
  existsSync,
  fdatasyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import {
  CONTEXT_SCHEMA_VERSION,
  evidenceID,
  parseManifest,
  parseRepositoryContext,
  parseTransaction,
  repositoryID,
  type ContextHistoryRecord,
  type ContextUpdateTransaction,
  type RepositoryContext,
  type RepositoryID,
  type RepositoryManifest,
} from "./types"

export class CorruptContextError extends Error {
  readonly file: string

  constructor(file: string, reason = "record could not be decoded") {
    super(`corrupt context record at ${file}: ${reason}`)
    this.name = "CorruptContextError"
    this.file = file
  }
}

export class UnsupportedContextSchemaError extends Error {
  readonly version: number

  constructor(version: number) {
    super(`unsupported context schema version: ${version}`)
    this.name = "UnsupportedContextSchemaError"
    this.version = version
  }
}

export type IndexSnapshot = Readonly<Record<string, readonly string[]>>

export interface Store {
  readonly root: string
  readonly repositoryPath: (repositoryID: RepositoryID) => string
  readonly contextPath: (repositoryID: RepositoryID) => string
  readonly load: (repositoryID: RepositoryID) => RepositoryContext | undefined
  readonly save: (context: RepositoryContext) => void
  readonly list: () => RepositoryManifest[]
  readonly remove: (repositoryID: RepositoryID) => void
  readonly history: (repositoryID: RepositoryID, limit?: number) => ContextHistoryRecord[]
  readonly recordHistory: (record: ContextHistoryRecord) => void
  readonly transactions: (repositoryID: RepositoryID, limit?: number) => ContextUpdateTransaction[]
  readonly recordTransaction: (transaction: ContextUpdateTransaction) => void
  readonly rebuildIndexes: (repositoryID: RepositoryID, indexes: IndexSnapshot) => void
  readonly indexes: (repositoryID: RepositoryID) => IndexSnapshot | undefined
}

export type OpenOptions = {
  readonly dataDir?: string
  readonly rootDirectory?: string
}

const stores = new Map<string, Store>()
const DIRECTORY_NAMES = [
  "architecture",
  "components",
  "pipelines",
  "flows",
  "modules",
  "findings",
  "graph",
  "indexes",
  "history",
  "transactions",
] as const

export function open(options: OpenOptions = {}): Store {
  const root = path.resolve(options.rootDirectory ?? path.join(options.dataDir ?? Global.Path.data, "context"))
  const existing = stores.get(root)
  if (existing) return existing
  mkdirSync(root, { recursive: true, mode: 0o700 })
  ensureSchema(root)
  const store = makeDiskStore(root)
  stores.set(root, store)
  return store
}

export function memory(): Store {
  const contexts = new Map<RepositoryID, RepositoryContext>()
  const histories = new Map<RepositoryID, ContextHistoryRecord[]>()
  const transactions = new Map<RepositoryID, ContextUpdateTransaction[]>()
  const derived = new Map<RepositoryID, IndexSnapshot>()
  return {
    root: "memory",
    repositoryPath: (repositoryID) => repositoryID,
    contextPath: (repositoryID) => repositoryID,
    load: (repositoryID) => contexts.get(repositoryID),
    save: (context) => contexts.set(context.manifest.repositoryID, context),
    list: () => [...contexts.values()].map((context) => context.manifest),
    remove: (repositoryID) => {
      contexts.delete(repositoryID)
      histories.delete(repositoryID)
      transactions.delete(repositoryID)
      derived.delete(repositoryID)
    },
    history: (repositoryID, limit = 100) => [...(histories.get(repositoryID) ?? [])].slice(-safeLimit(limit)).reverse(),
    recordHistory: (record) => {
      const current = histories.get(record.repositoryID) ?? []
      histories.set(record.repositoryID, [...current, record].slice(-500))
    },
    transactions: (repositoryID, limit = 100) =>
      [...(transactions.get(repositoryID) ?? [])].slice(-safeLimit(limit)).reverse(),
    recordTransaction: (transaction) => {
      const current = transactions.get(transaction.repositoryID) ?? []
      transactions.set(transaction.repositoryID, [...current, transaction].slice(-500))
    },
    rebuildIndexes: (repositoryID, indexes) => derived.set(repositoryID, cloneIndexes(indexes)),
    indexes: (repositoryID) => derived.get(repositoryID),
  }
}

function makeDiskStore(root: string): Store {
  const repositoryPath = (id: RepositoryID) => path.join(root, "repositories", safeID(id))
  const contextPath = (id: RepositoryID) => path.join(repositoryPath(id), "context.json")
  const manifestPath = (id: RepositoryID) => path.join(repositoryPath(id), "manifest.json")
  const historyDirectory = (id: RepositoryID) => path.join(repositoryPath(id), "history")
  const transactionDirectory = (id: RepositoryID) => path.join(repositoryPath(id), "transactions")
  const indexesPath = (id: RepositoryID) => path.join(repositoryPath(id), "indexes", "index.json")

  return {
    root,
    repositoryPath,
    contextPath,
    load: (id) => {
      const file = contextPath(id)
      if (!existsSync(file)) return undefined
      const value = decodeJson(file)
      const migrated = migrate(value)
      const context = parseRepositoryContext(migrated)
      if (!context || context.manifest.repositoryID !== id) throw new CorruptContextError(file)
      return context
    },
    save: (context) => {
      const id = context.manifest.repositoryID
      const file = contextPath(id)
      if (!parseRepositoryContext(JSON.parse(JSON.stringify(context)))) throw new CorruptContextError(file)
      ensureRepositoryDirectory(repositoryPath(id))
      atomicWrite(file, JSON.stringify(context, null, 2) + "\n")
      atomicWrite(manifestPath(id), JSON.stringify(context.manifest, null, 2) + "\n")
    },
    list: () => {
      const directory = path.join(root, "repositories")
      if (!existsSync(directory)) return []
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          try {
            const value = parseManifest(migrate(decodeJson(path.join(directory, entry.name, "manifest.json"))))
            return value ? [value] : []
          } catch {
            return []
          }
        })
        .toSorted((a, b) => b.updatedAt - a.updatedAt || a.repositoryID.localeCompare(b.repositoryID))
    },
    remove: (id) => {
      const directory = repositoryPath(id)
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true })
    },
    history: (id, limit = 100) => readRecords(historyDirectory(id), safeLimit(limit), parseHistory),
    recordHistory: (record) => {
      ensureRepositoryDirectory(repositoryPath(record.repositoryID))
      atomicWrite(
        path.join(historyDirectory(record.repositoryID), `${record.time}-${safeFilePart(record.id)}.json`),
        JSON.stringify(record, null, 2) + "\n",
      )
    },
    transactions: (id, limit = 100) => readRecords(transactionDirectory(id), safeLimit(limit), parseStoredTransaction),
    recordTransaction: (transaction) => {
      ensureRepositoryDirectory(repositoryPath(transaction.repositoryID))
      atomicWrite(
        path.join(
          transactionDirectory(transaction.repositoryID),
          `${transaction.createdAt}-${safeFilePart(transaction.id)}.json`,
        ),
        JSON.stringify(transaction, null, 2) + "\n",
      )
    },
    rebuildIndexes: (id, indexes) => {
      ensureRepositoryDirectory(repositoryPath(id))
      atomicWrite(indexesPath(id), JSON.stringify(indexes, null, 2) + "\n")
    },
    indexes: (id) => {
      const file = indexesPath(id)
      if (!existsSync(file)) return undefined
      const value = decodeJson(file)
      if (!record(value)) throw new CorruptContextError(file)
      return parseIndexes(value, file)
    },
  }
}

function ensureSchema(root: string): void {
  const file = path.join(root, "schema.json")
  if (!existsSync(file)) {
    atomicWrite(file, JSON.stringify({ schemaVersion: CONTEXT_SCHEMA_VERSION }) + "\n")
    return
  }
  const value = decodeJson(file)
  if (!record(value) || typeof value.schemaVersion !== "number")
    throw new CorruptContextError(file, "schema metadata is invalid")
  if (value.schemaVersion > CONTEXT_SCHEMA_VERSION) throw new UnsupportedContextSchemaError(value.schemaVersion)
  if (value.schemaVersion < CONTEXT_SCHEMA_VERSION)
    atomicWrite(file, JSON.stringify({ schemaVersion: CONTEXT_SCHEMA_VERSION }) + "\n")
}

function ensureRepositoryDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  for (const name of DIRECTORY_NAMES) mkdirSync(path.join(directory, name), { recursive: true, mode: 0o700 })
}

function decodeJson(file: string): unknown {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    throw new CorruptContextError(file, error instanceof Error ? error.message : String(error))
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new CorruptContextError(file, error instanceof Error ? error.message : String(error))
  }
}

function migrate(value: unknown): unknown {
  if (!record(value)) return value
  if (value.schemaVersion === undefined && value.version === CONTEXT_SCHEMA_VERSION) {
    if (record(value.manifest))
      return {
        ...value,
        schemaVersion: CONTEXT_SCHEMA_VERSION,
        manifest: { ...value.manifest, schemaVersion: CONTEXT_SCHEMA_VERSION },
      }
    return {
      ...value,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
    }
  }
  if (typeof value.schemaVersion === "number" && value.schemaVersion > CONTEXT_SCHEMA_VERSION)
    throw new UnsupportedContextSchemaError(value.schemaVersion)
  return value
}

function atomicWrite(file: string, content: string): void {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  let descriptor: number | undefined
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 })
    descriptor = openSync(temporary, "r")
    fdatasyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, file)
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    try {
      unlinkSync(temporary)
    } catch {}
    throw error
  }
}

function readRecords<T>(directory: string, limit: number, parse: (value: unknown) => T | undefined): T[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .toSorted((a, b) => b.name.localeCompare(a.name))
    .slice(0, limit)
    .flatMap((entry) => {
      try {
        const value = parse(decodeJson(path.join(directory, entry.name)))
        return value ? [value] : []
      } catch {
        return []
      }
    })
}

function parseStoredTransaction(value: unknown): ContextUpdateTransaction | undefined {
  return parseTransaction(value)
}

function parseHistory(value: unknown): ContextHistoryRecord | undefined {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    value.schemaVersion !== CONTEXT_SCHEMA_VERSION ||
    typeof value.transactionID !== "string" ||
    typeof value.repositoryID !== "string" ||
    typeof value.time !== "number" ||
    typeof value.reason !== "string" ||
    typeof value.oldSummary !== "string" ||
    typeof value.newSummary !== "string" ||
    !record(value.origin) ||
    typeof value.origin.taskID !== "string" ||
    !Array.isArray(value.evidenceIDs)
  )
    return undefined
  if (!value.evidenceIDs.every((item) => typeof item === "string")) return undefined
  try {
    return {
      id: value.id,
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      transactionID: value.transactionID,
      repositoryID: repositoryID(value.repositoryID),
      time: value.time,
      origin: {
        taskID: value.origin.taskID,
        ...(typeof value.origin.ownerID === "string" ? { ownerID: value.origin.ownerID } : {}),
      },
      reason: value.reason,
      oldSummary: value.oldSummary,
      newSummary: value.newSummary,
      evidenceIDs: value.evidenceIDs.map(evidenceID),
    }
  } catch {
    return undefined
  }
}

function parseIndexes(value: Record<string, unknown>, file: string): IndexSnapshot {
  const entries = Object.entries(value)
  if (!entries.every(([, item]) => Array.isArray(item) && item.every((entry) => typeof entry === "string")))
    throw new CorruptContextError(file, "derived index is invalid")
  return Object.fromEntries(
    entries.map(([key, item]) => [
      key,
      Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [],
    ]),
  )
}

function cloneIndexes(indexes: IndexSnapshot): IndexSnapshot {
  return Object.fromEntries(Object.entries(indexes).map(([key, value]) => [key, [...value]]))
}

function safeID(id: RepositoryID): string {
  return repositoryID(id)
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
}

function safeLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 500) : 100
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
