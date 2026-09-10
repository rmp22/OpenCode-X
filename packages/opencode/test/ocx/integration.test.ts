import { describe, expect } from "bun:test"
import { $ } from "bun"
import { Git } from "@opencode-ai/core/git"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect } from "effect"
import { join } from "node:path"
import { Integration } from "../../src/ocx/integration"
import { OCXDb } from "../../src/ocx/ocx-db"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Git.node))

describe("OCX integration", () => {
  it.live("captures an isolated owner change and integrates it atomically", () =>
    Effect.gen(function* () {
      const source = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await Bun.write(join(source.path, "auth.ts"), "export const auth = false\n")
        await $`git add auth.ts`.cwd(source.path).quiet()
        await $`git commit -m initial`.cwd(source.path).quiet()
      })
      const git = yield* Git.Service
      const repository = yield* git.repo.discover(AbsolutePath.make(source.path))
      expect(repository).toBeDefined()
      if (!repository) return
      const store = OCXDb.memory()
      const captured = yield* Integration.capture({
        repositoryID: source.path,
        ownerID: "owner_auth",
        taskID: "task_auth",
        primarySessionID: "session_primary",
        workdir: source.path,
        store,
        executor: (workdir) =>
          Effect.promise(async () => {
            await Bun.write(join(workdir, "auth.ts"), "export const auth = true\n")
            return { testsRun: ["bun test test/auth.test.ts"] }
          }),
      })

      expect(captured.record.status).toBe("captured")
      expect(captured.record.changedPaths).toEqual(["auth.ts"])
      expect(captured.record.worktree).not.toBe(source.path)
      expect(yield* Effect.promise(() => Bun.file(join(source.path, "auth.ts")).text())).toBe("export const auth = false\n")

      const integrated = yield* Integration.integrate({ workdir: source.path, repositoryID: source.path, store })

      expect(integrated.status).toBe("integrated")
      expect(integrated.integrated).toEqual([captured.record.id])
      expect(integrated.cleanupFailures).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(join(source.path, "auth.ts")).text())).toBe("export const auth = true\n")
      expect(store.getChangeset(captured.record.id)?.status).toBe("integrated")
      expect((yield* git.worktree.list(repository)).some((entry) => entry.directory === captured.record.worktree)).toBe(false)
    }),
  )

  it.live("rolls back the primary checkout when combined verification fails", () =>
    Effect.gen(function* () {
      const source = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await Bun.write(join(source.path, "auth.ts"), "export const auth = false\n")
        await $`git add auth.ts`.cwd(source.path).quiet()
        await $`git commit -m initial`.cwd(source.path).quiet()
      })
      const store = OCXDb.memory()
      const captured = yield* Integration.capture({
        repositoryID: source.path,
        ownerID: "owner_auth",
        taskID: "task_auth",
        primarySessionID: "session_primary",
        workdir: source.path,
        store,
        executor: (workdir) =>
          Effect.promise(async () => {
            await Bun.write(join(workdir, "auth.ts"), "export const auth = true\n")
            return {}
          }),
      })

      const integrated = yield* Integration.integrate({
        workdir: source.path,
        repositoryID: source.path,
        store,
        verify: () => Effect.fail(new Error("combined test failed")),
      })

      expect(integrated.status).toBe("rejected")
      expect(integrated.reasons.some((reason) => reason.includes("combined changeset verification failed"))).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(join(source.path, "auth.ts")).text())).toBe("export const auth = false\n")
      expect(store.getChangeset(captured.record.id)?.status).toBe("failed")
    }),
  )
})
