import { Effect } from "effect"
import { mkdirSync } from "node:fs"
import { dirname, extname, basename } from "node:path"
import { moduleForPath } from "./map"
import { classifyPath, languageForPath, relativePath } from "./profile"
import type { FileRecord, RepositoryMap } from "./types"

type Statement = {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => unknown
}

type Driver = {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
  close: () => void
}

export interface Index {
  readonly sync: (root: string, records: readonly FileRecord[], complete: boolean) => void
  readonly remove: (root: string, paths: readonly string[]) => void
  readonly lookupFile: (name: string, root?: string, limit?: number) => FileRecord[]
  readonly lookupPath: (fragment: string, root?: string, limit?: number) => FileRecord[]
  readonly listModuleFiles: (moduleID: string, root?: string, limit?: number) => FileRecord[]
  readonly lookupTests: (query: string, root?: string, limit?: number) => FileRecord[]
  readonly close: () => void
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS files (
    root TEXT NOT NULL,
    path TEXT NOT NULL,
    basename TEXT NOT NULL,
    extension TEXT NOT NULL,
    language TEXT,
    size INTEGER NOT NULL,
    modified_time INTEGER NOT NULL,
    module_id TEXT,
    root_type TEXT NOT NULL,
    is_generated INTEGER NOT NULL,
    is_dependency INTEGER NOT NULL,
    is_test INTEGER NOT NULL,
    is_tracked INTEGER NOT NULL,
    PRIMARY KEY (root, path)
  );
  CREATE INDEX IF NOT EXISTS codebase_files_basename_idx ON files(root, basename);
  CREATE INDEX IF NOT EXISTS codebase_files_path_idx ON files(root, path);
  CREATE INDEX IF NOT EXISTS codebase_files_module_idx ON files(root, module_id);
  CREATE INDEX IF NOT EXISTS codebase_files_language_idx ON files(root, language);
  CREATE INDEX IF NOT EXISTS codebase_files_class_idx ON files(root, root_type, is_test);
`

export function open(filename: string): Effect.Effect<Index, unknown> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => mkdirSync(dirname(filename), { recursive: true }),
      catch: (cause) => cause,
    })
    const driver = yield* Effect.tryPromise({
      try: () => loadDriver(filename),
      catch: (cause) => cause,
    })
    driver.exec("PRAGMA journal_mode = WAL")
    driver.exec("PRAGMA busy_timeout = 5000")
    driver.exec(CREATE_TABLE)
    const existing = driver.prepare("SELECT path FROM files WHERE root = ?")
    const removeStale = driver.prepare("DELETE FROM files WHERE root = ? AND path = ?")
    const upsert = driver.prepare(
      `INSERT INTO files (root, path, basename, extension, language, size, modified_time, module_id, root_type, is_generated, is_dependency, is_test, is_tracked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(root, path) DO UPDATE SET basename = excluded.basename, extension = excluded.extension, language = excluded.language, size = excluded.size, modified_time = excluded.modified_time, module_id = excluded.module_id, root_type = excluded.root_type, is_generated = excluded.is_generated, is_dependency = excluded.is_dependency, is_test = excluded.is_test, is_tracked = excluded.is_tracked`,
    )
    const remove = driver.prepare("DELETE FROM files WHERE root = ? AND path = ?")
    const fileQuery = driver.prepare(
      "SELECT root, path, basename, extension, language, size, modified_time, module_id, root_type, is_generated, is_dependency, is_test, is_tracked FROM files WHERE root = ? AND basename = ? ORDER BY path LIMIT ?",
    )
    const pathQuery = driver.prepare(
      "SELECT root, path, basename, extension, language, size, modified_time, module_id, root_type, is_generated, is_dependency, is_test, is_tracked FROM files WHERE root = ? AND path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?",
    )
    const moduleQuery = driver.prepare(
      "SELECT root, path, basename, extension, language, size, modified_time, module_id, root_type, is_generated, is_dependency, is_test, is_tracked FROM files WHERE root = ? AND module_id = ? ORDER BY path LIMIT ?",
    )
    const testQuery = driver.prepare(
      "SELECT root, path, basename, extension, language, size, modified_time, module_id, root_type, is_generated, is_dependency, is_test, is_tracked FROM files WHERE root = ? AND is_test = 1 AND (path LIKE ? ESCAPE '\\' OR basename LIKE ? ESCAPE '\\') ORDER BY path LIMIT ?",
    )

    const sync = (root: string, records: readonly FileRecord[], complete: boolean) => {
      const normalizedRoot = root
      driver.exec("BEGIN IMMEDIATE")
      try {
        if (complete) {
          const keep = new Set(records.map((record) => record.path))
          for (const row of existing.all(normalizedRoot)) {
            const pathValue = row && typeof row === "object" ? (row as Record<string, unknown>).path : undefined
            if (typeof pathValue === "string" && !keep.has(pathValue)) removeStale.run(normalizedRoot, pathValue)
          }
        }
        for (const record of records) {
          upsert.run(
            normalizedRoot,
            record.path,
            record.basename,
            record.extension,
            record.language ?? null,
            record.size,
            record.modifiedTime,
            record.moduleID ?? null,
            record.rootType,
            record.isGenerated ? 1 : 0,
            record.isDependency ? 1 : 0,
            record.isTest ? 1 : 0,
            record.isTracked ? 1 : 0,
          )
        }
        driver.exec("COMMIT")
      } catch (error) {
        driver.exec("ROLLBACK")
        throw error
      }
    }

    const query = (statement: Statement, params: unknown[]) => statement.all(...params).flatMap(decode)
    return {
      sync,
      remove: (root, paths) => paths.forEach((filepath) => remove.run(root, filepath)),
      lookupFile: (name, root, limit = 50) => query(fileQuery, [root ?? "", basename(name), safeLimit(limit)]),
      lookupPath: (fragment, root, limit = 50) =>
        query(pathQuery, [root ?? "", `%${escapeLike(fragment)}%`, safeLimit(limit)]),
      listModuleFiles: (moduleID, root, limit = 500) => query(moduleQuery, [root ?? "", moduleID, safeLimit(limit)]),
      lookupTests: (queryValue, root, limit = 100) =>
        query(testQuery, [root ?? "", `%${escapeLike(queryValue)}%`, `%${escapeLike(queryValue)}%`, safeLimit(limit)]),
      close: () => driver.close(),
    } satisfies Index
  })
}

export function recordsFromPaths(input: {
  readonly root: string
  readonly paths: readonly string[]
  readonly map?: RepositoryMap
  readonly tracked?: boolean
}): FileRecord[] {
  const root = input.root
  return [...new Set(input.paths)].map((filepath) => {
    const relative = relativePath(root, filepath)
    const rootType = classifyPath(relative)
    const module = input.map ? moduleForPath(input.map, relative) : undefined
    const language = languageForPath(relative)
    return {
      root,
      path: relative,
      basename: basename(relative),
      extension: extname(relative).toLowerCase(),
      ...(language ? { language } : {}),
      size: 0,
      modifiedTime: 0,
      ...(module ? { moduleID: module.id } : {}),
      rootType,
      isGenerated: rootType === "GENERATED",
      isDependency: rootType === "DEPENDENCY" || rootType === "VENDOR",
      isTest: rootType === "TEST",
      isTracked: input.tracked !== false,
    }
  })
}

async function loadDriver(filename: string): Promise<Driver> {
  const specifier = typeof Bun !== "undefined" ? "bun:sqlite" : "node:sqlite"
  const mod: Record<string, unknown> = await import(specifier)
  if (typeof Bun !== "undefined") {
    const Database = mod.default as new (file: string) => {
      exec: (sql: string) => void
      prepare: (sql: string) => Statement
      close: () => void
    }
    const database = new Database(filename)
    return {
      exec: (sql) => database.exec(sql),
      prepare: (sql) => {
        const statement = database.prepare(sql)
        return {
          get: (...params) => statement.get(...params),
          all: (...params) => statement.all(...params),
          run: (...params) => statement.run(...params),
        }
      },
      close: () => database.close(),
    }
  }
  const DatabaseSync = mod.DatabaseSync as new (file: string) => {
    exec: (sql: string) => void
    prepare: (sql: string) => Statement
    close: () => void
  }
  const database = new DatabaseSync(filename)
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.prepare(sql)
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        run: (...params) => statement.run(...params),
      }
    },
    close: () => database.close(),
  }
}

function decode(row: unknown): FileRecord[] {
  if (!row || typeof row !== "object") return []
  const value = row as Record<string, unknown>
  if (
    typeof value.root !== "string" ||
    typeof value.path !== "string" ||
    typeof value.basename !== "string" ||
    typeof value.extension !== "string" ||
    typeof value.size !== "number" ||
    typeof value.modified_time !== "number" ||
    typeof value.root_type !== "string"
  )
    return []
  return [
    {
      root: value.root,
      path: value.path,
      basename: value.basename,
      extension: value.extension,
      ...(typeof value.language === "string" ? { language: value.language } : {}),
      size: value.size,
      modifiedTime: value.modified_time,
      ...(typeof value.module_id === "string" ? { moduleID: value.module_id } : {}),
      rootType: value.root_type as FileRecord["rootType"],
      isGenerated: value.is_generated === 1,
      isDependency: value.is_dependency === 1,
      isTest: value.is_test === 1,
      isTracked: value.is_tracked === 1,
    },
  ]
}

function safeLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 10_000) : 50
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

export * as CodebasePathIndex from "./path-index"
