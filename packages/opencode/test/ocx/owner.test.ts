import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { Global } from "@opencode-ai/core/global"
import { Effect, Exit } from "effect"
import { OwnerLifecycle } from "../../src/ocx/owner/lifecycle"
import { OwnerRegistry } from "../../src/ocx/owner/registry"
import { OwnerRouter } from "../../src/ocx/owner/router"
import { OwnerSession } from "../../src/ocx/owner/session-filter"
import { tmpdir } from "../fixture/fixture"

describe("persistent OCX owners", () => {
  test("starts empty, creates a domain owner, and reuses it for different wording", async () => {
    await using first = await tmpdir()
    const repositoryID = OwnerRegistry.repositoryID(first.path)
    const store = await Effect.runPromise(OwnerRegistry.open(first.path, "ses_owner_first"))
    expect(store.list(repositoryID)).toHaveLength(0)

    const created = await Effect.runPromise(
      OwnerLifecycle.route({ workdir: first.path, sessionID: "ses_owner_first", prompt: "Implement OAuth login" }),
    )
    const reused = await Effect.runPromise(
      OwnerLifecycle.route({ workdir: first.path, sessionID: "ses_owner_first", prompt: "Fix expired access tokens" }),
    )

    expect(created.owners.map((owner) => owner.topic)).toContain("authentication")
    const authenticationOwner = created.owners.find((owner) => owner.topic === "authentication")
    expect(authenticationOwner).toBeDefined()
    expect(reused.owners.map((owner) => owner.id)).toContain(authenticationOwner!.id)
    expect((await Effect.runPromise(OwnerRegistry.open(first.path, "ses_owner_first"))).list(repositoryID)).toHaveLength(1)
  })

  test("isolates owners between repositories and supports multiple domains", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    const created = await Effect.runPromise(
      OwnerLifecycle.route({ workdir: first.path, sessionID: "ses_owner_first", prompt: "Add authentication networking retry" }),
    )
    const other = await Effect.runPromise(
      OwnerLifecycle.route({ workdir: second.path, sessionID: "ses_owner_second", prompt: "Fix authentication" }),
    )

    expect(created.owners.map((owner) => owner.topic)).toEqual(["authentication", "networking"])
    expect(other.owners[0]?.id).not.toBe(created.owners[0]?.id)
    expect(OwnerRegistry.filePath("ses_owner_first")).toBe(
      join(Global.Path.data, "ocx", "owners", "ses_owner_first", "owners.db"),
    )
    expect(OwnerRegistry.filePath("ses_owner_first")).not.toContain(first.path)
    expect(OwnerRegistry.filePath("ses_owner_first")).not.toContain(second.path)
    expect(await Bun.file(OwnerRegistry.filePath("ses_owner_first")).exists()).toBe(true)
    expect(await Bun.file(join(first.path, ".ocx", "owners.db")).exists()).toBe(false)
  })

  test("does not allow two leases for one owner at the same time", () => {
    const store = OwnerRegistry.memory()
    const owner = store.create({
      repositoryID: "repo",
      name: "Authentication Owner",
      topic: "authentication",
      description: "auth",
      scopes: [{ type: "topic", value: "authentication", priority: 1 }],
    })

    expect(store.acquire(owner.id, "one", 10_000)).toBe(true)
    expect(store.acquire(owner.id, "two", 10_000)).toBe(false)
    store.release(owner.id, "one")
    expect(store.acquire(owner.id, "two", 10_000)).toBe(true)
  })

  test("migrates a repository-local owner database before removing the legacy files", async () => {
    await using source = await tmpdir()
    await using target = await tmpdir()
    const sourceSessionID = "ses_owner_migration_source"
    const sourceRoute = await Effect.runPromise(
      OwnerLifecycle.route({ workdir: source.path, sessionID: sourceSessionID, prompt: "Implement OAuth login" }),
    )
    const sourceDatabase = OwnerRegistry.filePath(sourceSessionID)
    const legacyDirectory = join(target.path, ".ocx")
    const legacyDatabase = join(legacyDirectory, "owners.db")
    mkdirSync(legacyDirectory, { recursive: true })
    for (const suffix of ["", "-wal", "-shm"]) {
      const sourceFile = `${sourceDatabase}${suffix}`
      if (existsSync(sourceFile)) copyFileSync(sourceFile, `${legacyDatabase}${suffix}`)
    }

    const { default: Database } = await import("bun:sqlite")
    const database = new Database(legacyDatabase)
    database.prepare("UPDATE owners SET repository_id = ?").run(OwnerRegistry.repositoryID(target.path))
    database.close()

    const migrated = await Effect.runPromise(
      OwnerLifecycle.route({ workdir: target.path, sessionID: "ses_owner_migration_target", prompt: "Fix expired access tokens" }),
    )
    const sourceOwner = sourceRoute.owners.find((owner) => owner.topic === "authentication")
    const migratedOwner = migrated.owners.find((owner) => owner.topic === "authentication")

    expect(migratedOwner?.id).toBe(sourceOwner?.id)
    expect(await Bun.file(OwnerRegistry.filePath("ses_owner_migration_target")).exists()).toBe(true)
    for (const suffix of ["", "-wal", "-shm"]) expect(existsSync(`${legacyDatabase}${suffix}`)).toBe(false)
  })

  test("keeps the legacy database when migration validation fails", async () => {
    await using temp = await tmpdir()
    const legacyDirectory = join(temp.path, ".ocx")
    const legacyDatabase = join(legacyDirectory, "owners.db")
    mkdirSync(legacyDirectory, { recursive: true })
    await Bun.write(legacyDatabase, "not a sqlite database")

    const exit = await Effect.runPromise(
      OwnerLifecycle.route({ workdir: temp.path, sessionID: "ses_owner_migration_failure", prompt: "Fix expired access tokens" }).pipe(Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(existsSync(legacyDatabase)).toBe(true)
    expect(await Bun.file(OwnerRegistry.filePath("ses_owner_migration_failure")).exists()).toBe(false)
  })

  test("routes through semantic and path evidence instead of exact wording", () => {
    const store = OwnerRegistry.memory()
    const owner = store.create({
      repositoryID: "repo",
      name: "Authentication Owner",
      topic: "authentication",
      description: "access token and credential handling",
      scopes: [{ type: "directory", value: "src/security", priority: 4 }],
    })
    const match = OwnerRouter.rank([owner], {
      prompt: "repair credential renewal",
      paths: ["src/security/token.ts"],
    })
    expect(match[0]?.owner.id).toBe(owner.id)
    expect(match[0]?.score).toBeGreaterThan(0)
  })

  test("classifies only owner sessions as internal", () => {
    expect(OwnerSession.isInternal({ metadata: { ocx: { sessionKind: "owner" } } })).toBe(true)
    expect(OwnerSession.isInternal({ metadata: { ocx: { sessionKind: "primary" } } })).toBe(false)
    expect(OwnerSession.isInternal({ metadata: undefined })).toBe(false)
  })
})
