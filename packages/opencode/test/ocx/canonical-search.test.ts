import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import type { Match } from "@opencode-ai/schema/filesystem"
import {
  SearchService,
  makeSearchService,
  SearchCache,
  defaultSearchCache,
} from "../../src/ocx/search"

describe("Canonical Search Service", () => {
  test("cache keys are deterministic and distinguish query options", () => {
    const k1 = SearchCache.key({
      pattern: "hello",
      cwd: "/repo",
      scope: "/repo",
      include: "*.ts",
      caseSensitive: true,
      wholeWord: false,
    })
    const k2 = SearchCache.key({
      pattern: "hello",
      cwd: "/repo",
      scope: "/repo",
      include: "*.ts",
      caseSensitive: true,
      wholeWord: false,
    })
    const k3 = SearchCache.key({
      pattern: "hello",
      cwd: "/repo",
      scope: "/repo",
      include: "*.ts",
      caseSensitive: false,
      wholeWord: false,
    })

    expect(k1).toBe(k2)
    expect(k1).not.toBe(k3)
  })

  test("cache sets, gets, and invalidates on scope", () => {
    const cache = new SearchCache()
    const entry = {
      key: "search::1",
      cwd: "/repo/sub",
      value: [{ file: "/repo/sub/a.ts", line: 10, text: "foo" }],
      createdAt: Date.now(),
    }
    cache.set(entry)
    expect(cache.get("search::1")?.value).toEqual(entry.value)

    cache.invalidate("/repo/sub")
    expect(cache.get("search::1")).toBeUndefined()
  })

  test("search service executes, auto-narrows, caches, and trips circuit breaker", async () => {
    let mockGrepCalls = 0
    let lastGlob: string | undefined

    const mockRipgrep = Ripgrep.Service.of({
      find: () => Effect.succeed([]),
      glob: () => Effect.succeed([]),
      grep: (input): Effect.Effect<readonly Match[], Ripgrep.Error | Ripgrep.InvalidPatternError> => {
        mockGrepCalls++
        lastGlob = input.include
        if (input.pattern === "FAIL_TRIGGER") {
          return Effect.fail(new Ripgrep.Error({ message: "Simulated regex syntax error" }))
        }
        if (input.pattern === "OVERFLOW_TRIGGER" && !input.include) {
          const overflowMatches: Match[] = Array.from({ length: 600 }, (_, i) => ({
            entry: { path: `file_${i}.txt` as any, type: "file" },
            line: i + 1,
            text: `match line ${i}`,
            offset: i * 10,
            submatches: [{ text: "match", start: 0, end: 5 }],
          }))
          return Effect.succeed(overflowMatches)
        }
        if (input.pattern === "EMPTY_TRIGGER") {
          return Effect.succeed([])
        }
        const regularMatches: Match[] = [
          {
            entry: { path: "packages/opencode/src/index.ts" as any, type: "file" },
            line: 42,
            text: "export const answer = 42",
            offset: 100,
            submatches: [{ text: "answer", start: 13, end: 19 }],
          },
        ]
        return Effect.succeed(regularMatches)
      },
    })

    const testEnv = Layer.mergeAll(
      Layer.succeed(Ripgrep.Service, mockRipgrep),
      Layer.succeed(SearchCache.Service, defaultSearchCache),
    )

    const runner = Effect.gen(function* () {
      const search = yield* makeSearchService

      const res1 = yield* search.search({
        pattern: "answer",
        cwd: "/repo",
      })
      expect(res1.matches.length).toBe(1)
      expect(res1.matches[0].line).toBe(42)
      expect(res1.matches[0].column).toBe(14)
      expect(res1.cached).toBe(false)

      const res2 = yield* search.search({
        pattern: "answer",
        cwd: "/repo",
      })
      expect(res2.cached).toBe(true)
      expect(mockGrepCalls).toBe(1)

      yield* search.invalidate("/repo")
      const res3 = yield* search.search({
        pattern: "answer",
        cwd: "/repo",
      })
      expect(res3.cached).toBe(false)
      expect(mockGrepCalls).toBe(2)

      const overflowRes = yield* search.search({
        pattern: "OVERFLOW_TRIGGER",
        cwd: "/repo",
        maxResults: 500,
      })
      expect(overflowRes.autoNarrowed).toBe(true)
      expect(lastGlob).toBeDefined()

      for (let i = 0; i < 3; i++) {
        yield* search
          .search({ pattern: "FAIL_TRIGGER", cwd: "/repo" })
          .pipe(Effect.catch(() => Effect.void))
      }
      const health = yield* search.getHealth()
      expect(health.circuitBroken).toBe(true)
      expect(health.consecutiveFailures).toBe(3)

      const blockedAttempt = yield* search
        .search({ pattern: "FAIL_TRIGGER", cwd: "/repo" })
        .pipe(
          Effect.map((right) => ({ _tag: "Right" as const, right })),
          Effect.catch((left) => Effect.succeed({ _tag: "Left" as const, left })),
        )
      expect(blockedAttempt._tag).toBe("Left")

      yield* search.resetHealth()
      const restoredHealth = yield* search.getHealth()
      expect(restoredHealth.circuitBroken).toBe(false)
    }).pipe(Effect.provide(testEnv))

    await Effect.runPromise(runner)
  })

  test("truthful no-match reporting when results are empty", async () => {
    const mockRipgrep = Ripgrep.Service.of({
      find: () => Effect.succeed([]),
      glob: () => Effect.succeed([]),
      grep: () => Effect.succeed([]),
    })

    const testEnv = Layer.mergeAll(
      Layer.succeed(Ripgrep.Service, mockRipgrep),
      Layer.succeed(SearchCache.Service, new SearchCache()),
    )

    const runner = Effect.gen(function* () {
      const search = yield* makeSearchService
      const res = yield* search.search({
        pattern: "NON_EXISTENT_TOKEN",
        cwd: "/workspace",
        paths: ["src/tools"],
      })
      expect(res.matches.length).toBe(0)
      expect(res.total).toBe(0)
      expect(res.truncated).toBe(false)
      expect(res.scope).toBe("src/tools")
    }).pipe(Effect.provide(testEnv))

    await Effect.runPromise(runner)
  })
})
