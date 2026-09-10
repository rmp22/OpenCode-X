import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ContextService } from "../../src/ocx/context/service"
import { RepositoryIdentityResolver } from "../../src/ocx/context/identity"
import { ContextStore, CorruptContextError, UnsupportedContextSchemaError } from "../../src/ocx/context/store"
import { ContextTransactionManager } from "../../src/ocx/context/transaction"
import { CONTEXT_SCHEMA_VERSION, repositoryID, type RepositoryContext } from "../../src/ocx/context/types"

function context(root: string): RepositoryContext {
  const repository = RepositoryIdentityResolver.resolve({
    root,
    remotes: ["https://github.com/example/context-fixture.git"],
    rootFingerprint: "fixture",
  })
  return ContextService.emptyContext({
    id: repository.id,
    displayName: repository.displayName,
    identity: repository.identity,
    root,
    now: 1,
  })
}

describe("context store", () => {
  test("persists canonical records and rebuildable indexes atomically", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-store-"))
    try {
      const store = ContextStore.open({ rootDirectory: root })
      const value = context(root)
      store.save(value)
      expect(store.load(value.manifest.repositoryID)).toEqual(value)
      expect(JSON.parse(readFileSync(path.join(root, "schema.json"), "utf8"))).toEqual({ schemaVersion: 1 })
      const repositoryDirectory = store.repositoryPath(value.manifest.repositoryID)
      expect(readdirSync(repositoryDirectory)).toEqual(
        expect.arrayContaining(["manifest.json", "context.json", "history", "transactions", "indexes"]),
      )
      expect(readdirSync(repositoryDirectory).some((name) => name.includes(".tmp-") || name.endsWith(".tmp"))).toBe(
        false,
      )

      store.rebuildIndexes(value.manifest.repositoryID, { files: ["src/service.ts=node-service"] })
      expect(store.indexes(value.manifest.repositoryID)).toEqual({ files: ["src/service.ts=node-service"] })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("records history and applied transaction files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-history-"))
    try {
      const store = ContextStore.open({ rootDirectory: root })
      const value = context(root)
      store.save(value)
      const transaction = ContextTransactionManager.create({
        repositoryID: value.manifest.repositoryID,
        origin: { taskID: "test-task", ownerID: "context-domain" },
        reason: "test history",
        operations: [],
        now: 2,
      })
      store.recordTransaction({ ...transaction, status: "APPLIED" })
      store.recordHistory({
        id: "history-test",
        schemaVersion: CONTEXT_SCHEMA_VERSION,
        transactionID: transaction.id,
        repositoryID: value.manifest.repositoryID,
        time: 2,
        origin: transaction.origin,
        reason: transaction.reason,
        oldSummary: "empty",
        newSummary: "one node",
        evidenceIDs: [],
      })
      expect(store.transactions(value.manifest.repositoryID)).toHaveLength(1)
      expect(store.history(value.manifest.repositoryID)[0]?.reason).toBe("test history")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("reports corrupt canonical records instead of returning partial state", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-corrupt-"))
    try {
      const store = ContextStore.open({ rootDirectory: root })
      const value = context(root)
      store.save(value)
      writeFileSync(store.contextPath(value.manifest.repositoryID), "{")
      expect(() => store.load(value.manifest.repositoryID)).toThrow(CorruptContextError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("rejects an unsupported schema before opening the store", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-version-"))
    try {
      writeFileSync(path.join(root, "schema.json"), JSON.stringify({ schemaVersion: CONTEXT_SCHEMA_VERSION + 1 }))
      expect(() => ContextStore.open({ rootDirectory: root })).toThrow(UnsupportedContextSchemaError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("upgrades the known older schema marker without touching source files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-migrate-"))
    try {
      writeFileSync(path.join(root, "schema.json"), JSON.stringify({ schemaVersion: 0 }))
      const store = ContextStore.open({ rootDirectory: root })
      expect(JSON.parse(readFileSync(path.join(root, "schema.json"), "utf8"))).toEqual({ schemaVersion: 1 })
      expect(store.list()).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("removes only the context directory through the store", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ocx-context-forget-"))
    try {
      const store = ContextStore.open({ rootDirectory: root })
      const value = context(root)
      store.save(value)
      const source = path.join(root, "source.ts")
      writeFileSync(source, "keep")
      store.remove(value.manifest.repositoryID)
      expect(readFileSync(source, "utf8")).toBe("keep")
      expect(store.load(value.manifest.repositoryID)).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("keeps in-memory stores isolated and listable", () => {
    const store = ContextStore.memory()
    const value = context("/tmp/memory-context")
    store.save(value)
    expect(store.list().map((item) => item.repositoryID)).toEqual([value.manifest.repositoryID])
    expect(store.load(repositoryID(`repo-${"f".repeat(32)}`))).toBeUndefined()
  })
})
