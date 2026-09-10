import { describe, expect, test } from "bun:test"
import { discoverMap } from "../../src/ocx/codebase/map"
import { append, parseLines, record } from "../../src/ocx/codebase/history"
import { profileFromPaths } from "../../src/ocx/codebase/profile"
import {
  classifyIntent,
  explicitFullSearch,
  guardFailure,
  guardSearch,
  planSearch,
  routeFor,
  searchCommand,
} from "../../src/ocx/codebase/search"
import { CodebaseWorkingSet } from "../../src/ocx/codebase/working-set"
import { DEFAULT_CODEBASE_CONFIG } from "../../src/ocx/codebase/types"

const profile = profileFromPaths({
  root: "/repo",
  paths: ["src/auth.ts", "src/auth.test.ts", "services/api/index.ts"],
  rootEntries: ["src", "services"],
  thresholds: DEFAULT_CODEBASE_CONFIG.scaleThresholds,
})
const map = discoverMap({ root: "/repo", paths: ["src/auth.ts", "services/api/index.ts"] })

describe("codebase search planning", () => {
  test("classifies explicit intents before heuristic fallbacks", () => {
    expect(classifyIntent({ query: "Where is Foo defined?" })).toContain("DEFINITION")
    expect(classifyIntent({ query: "find config for auth" })).toContain("CONFIG")
    expect(classifyIntent({ query: "FooService" })).toEqual(["SYMBOL"])
  })

  test("prefers a working-set module over the repository root", () => {
    const workingSet = CodebaseWorkingSet.updateFromPaths(CodebaseWorkingSet.create("session"), {
      modules: ["services/api"],
      reason: "definition found",
      confidence: 1,
    })
    const plan = planSearch({
      root: "/repo",
      request: { query: "ApiService" },
      profile,
      map,
      workingSet,
    })
    expect(plan.selected.scope).toBe("/repo/services/api")
    expect(plan.candidates.some((item) => item.scope === "/repo")).toBe(false)
  })

  test("blocks or rewrites large root scans and allows explicit full search", () => {
    const massive = { ...profile, scale: "MASSIVE" as const, estimatedFileCount: 500_000 }
    const route = {
      family: "recursive_text_search" as const,
      scope: "/repo",
      recursive: true,
      intent: ["TEXT" as const],
      explicitRepositoryWide: false,
    }
    expect(
      guardSearch({ route, profile: massive, config: DEFAULT_CODEBASE_CONFIG, recommendedScopes: ["src"] }).action,
    ).toBe("REWRITE")
    expect(guardSearch({ route, profile: massive, config: DEFAULT_CODEBASE_CONFIG }).action).toBe("BLOCK")
    expect(
      guardSearch({
        route: { ...route, explicitRepositoryWide: true },
        profile: massive,
        config: DEFAULT_CODEBASE_CONFIG,
      }).action,
    ).toBe("ALLOW_WITH_BUDGET")
    expect(
      planSearch({ root: "/repo", request: { query: "Foo", explicitRepositoryWide: true }, profile: massive, map })
        .selected.scope,
    ).toBe("/repo")
    expect(
      guardSearch({ route: { ...route, include: "*.ts" }, profile: massive, config: DEFAULT_CODEBASE_CONFIG }).action,
    ).toBe("ALLOW_WITH_BUDGET")
  })

  test("normalizes raw search commands and recognizes full-search intent", () => {
    expect(searchCommand("rg --count Foo src")?.scope).toBe("src")
    expect(searchCommand("grep -R Foo .")?.family).toBe("recursive_text_search")
    expect(explicitFullSearch("Search the entire repository for Foo")).toBe(true)
  })

  test("recognizes equivalent failed searches across the same strategy family", () => {
    const failed = record({
      query: "foo",
      intent: ["TEXT"],
      scope: "/repo",
      family: "recursive_text_search",
      repositoryRevision: "abc",
      startTime: 1,
      durationMs: 8_000,
      timeout: true,
      outputCount: 0,
      resultQuality: "failed",
      failureReason: "hard_timeout",
    })
    const history = append({ records: [], stats: [] }, failed)
    expect(parseLines(JSON.stringify({ ...failed, searchFamily: "not-a-family" }))).toEqual([])
    expect(
      guardFailure(history.records, {
        query: "foo",
        scope: "/repo",
        family: "recursive_text_search",
        repositoryRevision: "abc",
      }),
    ).toBeDefined()
    expect(
      guardFailure(history.records, {
        query: "foo",
        scope: "/repo/src",
        family: "recursive_text_search",
        repositoryRevision: "abc",
      }),
    ).toBeUndefined()
  })

  test("uses a bounded scale budget for scoped routes", () => {
    const decision = guardSearch({
      route: routeFor(planSearch({ root: "/repo", request: { query: "auth", requestedScope: "src" }, profile, map }), {
        family: "recursive_text_search",
      }),
      profile: { ...profile, scale: "LARGE" },
      config: DEFAULT_CODEBASE_CONFIG,
    })
    expect(decision.action).toBe("ALLOW_WITH_BUDGET")
    expect(decision.budget.hardTimeoutMs).toBe(10_000)
  })
})
