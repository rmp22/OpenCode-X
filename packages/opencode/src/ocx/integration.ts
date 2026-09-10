import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Git } from "@opencode-ai/core/git"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { KeyedMutex } from "@opencode-ai/core/effect/keyed-mutex"
import { Cause, Effect, Exit } from "effect"
import { Changeset } from "./changeset"
import { Eval } from "./eval"
import { OCXDb } from "./ocx-db"

export type CaptureInput<R = never> = {
  readonly repositoryID: string
  readonly ownerID: string
  readonly taskID: string
  readonly primarySessionID: string
  readonly workdir: string
  readonly executor: (workdir: string) => Effect.Effect<Partial<Changeset.Evidence>, unknown, R>
  readonly store?: OCXDb.Store
}

export type CaptureResult = {
  readonly record: Changeset.Record
  readonly executionError?: string
}

export type IntegrateInput = {
  readonly workdir: string
  readonly repositoryID?: string
  readonly changesets?: readonly Changeset.Record[]
  readonly store?: OCXDb.Store
  readonly verify?: (workdir: string) => Effect.Effect<void, unknown>
}

export type IntegrationResult = {
  readonly status: "integrated" | "rejected"
  readonly integrated: readonly string[]
  readonly reasons: readonly string[]
  readonly cleanupFailures: readonly string[]
}

const locks = KeyedMutex.makeUnsafe<string>()
const WORKTREE_PREFIX = "opencode-owner-"
const EMPTY_REVISION = "EMPTY"

export function capture<R>(input: CaptureInput<R>): Effect.Effect<CaptureResult, unknown, R | Git.Service> {
  return Effect.gen(function* () {
    const git = yield* Git.Service
    const store = input.store ?? (yield* OCXDb.shared)
    const repository = yield* git.repo.discover(AbsolutePath.make(input.workdir))
    if (!repository) return yield* Effect.fail(new Error(`Git repository not found: ${input.workdir}`))
    const baseRevision = (yield* git.history.head(repository)) ?? EMPTY_REVISION
    const parent = yield* temporaryParent()
    const worktreePath = path.join(parent, "worktree")
    const created = yield* Effect.exit(
      git.worktree.create({ repository, directory: AbsolutePath.make(worktreePath) }),
    )
    if (Exit.isFailure(created)) {
      yield* cleanupParent(parent)
      return yield* Effect.failCause(created.cause)
    }

    const worktree = created.value
    const before = yield* git.tree.capture({ repository: worktree, scopes: [RelativePath.make(".")] })
    const execution = yield* Effect.exit(input.executor(worktreePath))
    const after = yield* git.tree.capture({ repository: worktree, scopes: [RelativePath.make(".")] })
    const changePatch = yield* git.change.capture({ repository: worktree, path: worktree.worktree })
    const changedPaths = yield* git.tree.files({ repository: worktree, from: before, to: after })
    const executionError = Exit.isFailure(execution) ? Cause.pretty(execution.cause) : undefined
    const now = Date.now()
    const record: Changeset.Record = {
      id: `changeset_${randomUUID().replaceAll("-", "")}`,
      repositoryID: input.repositoryID,
      taskID: input.taskID,
      ownerID: input.ownerID,
      primarySessionID: input.primarySessionID,
      baseRevision,
      worktree: worktreePath,
      patch: changePatch,
      changedPaths: changedPaths.map((file) => file as string),
      affectedSymbols: execution && Exit.isSuccess(execution) ? execution.value.affectedSymbols ?? [] : [],
      assumptions: execution && Exit.isSuccess(execution) ? execution.value.assumptions ?? [] : [],
      dependencies: execution && Exit.isSuccess(execution) ? execution.value.dependencies ?? [] : [],
      invariantsChecked: execution && Exit.isSuccess(execution) ? execution.value.invariantsChecked ?? [] : [],
      testsRun: execution && Exit.isSuccess(execution) ? execution.value.testsRun ?? [] : [],
      unverifiedItems: execution && Exit.isSuccess(execution) ? execution.value.unverifiedItems ?? [] : [],
      integrationNotes: executionError ? [`owner execution failed: ${executionError}`] : [],
      status: executionError ? "failed" : "captured",
      createdAt: now,
      updatedAt: now,
    }
    store.recordChangeset(record)
    return { record, ...(executionError ? { executionError } : {}) }
  })
}

export function integrate(input: IntegrateInput): Effect.Effect<IntegrationResult, unknown, Git.Service> {
  return Effect.gen(function* () {
    const git = yield* Git.Service
    const store = input.store ?? (yield* OCXDb.shared)
    const repository = yield* git.repo.discover(AbsolutePath.make(input.workdir))
    if (!repository)
      return {
        status: "rejected",
        integrated: [],
        reasons: [`Git repository not found: ${input.workdir}`],
        cleanupFailures: [],
      } satisfies IntegrationResult
    const repositoryID = input.repositoryID ?? String(repository.worktree)
    return yield* locks.withLock(String(repository.commonDirectory))(
      Effect.gen(function* () {
        const records = [...(input.changesets ?? store.changesets(repositoryID))].filter(
          (record) => record.repositoryID === repositoryID && record.status === "captured",
        )
        const currentRevision = (yield* git.history.head(repository)) ?? EMPTY_REVISION
        const primaryPatch = yield* git.change.capture({ repository, path: repository.worktree })
        const managed = records.filter((record) => isManagedWorktree(record.worktree))
        const unmanaged = records.filter((record) => !isManagedWorktree(record.worktree))
        const decision = Changeset.canIntegrate({
          records: managed,
          currentRevision,
          primaryClean: primaryPatch.length === 0 && unmanaged.length === 0,
        })
        if (records.length === 0) return rejected(["no captured changesets"])
        if (unmanaged.length > 0) {
          return rejected([
            ...decision.ok ? [] : decision.reasons,
            ...unmanaged.map((record) => `${record.id} has an unmanaged worktree path`),
          ])
        }
        if (!decision.ok) {
          for (const record of records) store.updateChangeset(record.id, { status: "conflict", integrationNotes: decision.reasons })
          return rejected(decision.reasons)
        }

        const applied = yield* Effect.exit(
          git.change.apply({
            repository,
            path: repository.worktree,
            changes: Git.ChangeSet.make(managed.map((record) => record.patch).join("\n")),
          }),
        )
        if (Exit.isFailure(applied)) {
          const reason = Cause.pretty(applied.cause)
          const rollback = yield* discardPrimary(git, repository)
          for (const record of records) store.updateChangeset(record.id, { status: "conflict", integrationNotes: [reason] })
          return rejected([`combined changeset apply failed: ${reason}`, ...(rollback ? [`primary rollback failed: ${rollback}`] : [])])
        }

        if (input.verify) {
          const verification = yield* Effect.exit(input.verify(repository.worktree as string))
          if (Exit.isFailure(verification)) {
            const reason = Cause.pretty(verification.cause)
            const rollback = yield* discardPrimary(git, repository)
            const notes = [`combined changeset verification failed: ${reason}`]
            if (rollback) notes.push(`primary rollback failed: ${rollback}`)
            for (const record of records) store.updateChangeset(record.id, { status: "failed", integrationNotes: notes })
            return rejected(notes)
          }
        }

        const resultingRevision = yield* git.history.head(repository)
        const cleanupFailures: string[] = []
        for (const record of records) {
          store.updateChangeset(record.id, {
            status: "integrated",
            ...(resultingRevision ? { resultingRevision } : {}),
            integrationNotes: [`integrated into ${currentRevision}`],
          })
          const ownerRepository = yield* git.repo.discover(AbsolutePath.make(record.worktree))
          if (!ownerRepository) {
            cleanupFailures.push(`${record.id}: owner worktree is no longer available`)
            continue
          }
          const reset = yield* Effect.exit(
            git.change.discard({
              repository: ownerRepository,
              path: ownerRepository.worktree,
              index: "reset",
              untracked: "remove",
            }),
          )
          if (Exit.isFailure(reset)) {
            cleanupFailures.push(`${record.id}: ${Cause.pretty(reset.cause)}`)
            continue
          }
          const removed = yield* Effect.exit(
            git.worktree.remove({
              repository,
              directory: AbsolutePath.make(record.worktree),
              force: false,
            }),
          )
          if (Exit.isFailure(removed)) {
            cleanupFailures.push(`${record.id}: ${Cause.pretty(removed.cause)}`)
            continue
          }
          yield* cleanupParent(path.dirname(record.worktree))
        }
        return {
          status: "integrated",
          integrated: records.map((record) => record.id),
          reasons: [],
          cleanupFailures,
        } satisfies IntegrationResult
      }),
    )
  })
}

function discardPrimary(git: Git.Interface, repository: Git.Repository): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    const reset = yield* Effect.exit(
      git.change.discard({
        repository,
        path: repository.worktree,
        index: "reset",
        untracked: "remove",
      }),
    )
    return Exit.isFailure(reset) ? Cause.pretty(reset.cause) : undefined
  })
}

function rejected(reasons: readonly string[]): IntegrationResult {
  return { status: "rejected", integrated: [], reasons, cleanupFailures: [] }
}

function temporaryParent(): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: () => mkdtemp(path.join(os.tmpdir(), WORKTREE_PREFIX)),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function cleanupParent(directory: string): Effect.Effect<void> {
  return Effect.promise(() => rm(directory, { recursive: true, force: true }))
}

function isManagedWorktree(value: string): boolean {
  const parent = path.basename(path.dirname(value))
  return parent.startsWith(WORKTREE_PREFIX) && path.basename(value) === "worktree"
}

export * as Integration from "./integration"
