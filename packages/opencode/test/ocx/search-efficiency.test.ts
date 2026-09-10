import { describe, expect, test } from "bun:test"
import { ObservationCache } from "@/ocx/search"

describe("Observation Cache & Search Efficiency", () => {
  test("returns cached observation on identical query, scope, and revision", () => {
    const cache = new ObservationCache()
    const query = "rg 'export function authenticate'"
    const scope = "packages/core/src"
    const rev = "commit_abc123"

    expect(cache.get(query, scope, rev)).toBeUndefined()

    cache.set(query, scope, rev, "export function authenticate(token: string): boolean")

    const cached = cache.get<string>(query, scope, rev)
    expect(cached).toBe("export function authenticate(token: string): boolean")

    const metrics = cache.getMetrics()
    expect(metrics.totalQueries).toBe(2)
    expect(metrics.cachedHits).toBe(1)
    expect(metrics.hitRate).toBe(0.5)
  })

  test("invalidates observation when repo revision changes after mutation", () => {
    const cache = new ObservationCache()
    const query = "git status"
    const scope = "."
    const rev1 = 1
    const rev2 = 2

    cache.set(query, scope, rev1, "nothing to commit, working tree clean")
    expect(cache.get<string>(query, scope, rev1)).toBe("nothing to commit, working tree clean")

    cache.invalidateRepoRevision(rev2)

    expect(cache.get(query, scope, rev2)).toBeUndefined()

    cache.set(query, scope, rev2, "modified: src/auth.ts")
    expect(cache.get<string>(query, scope, rev2)).toBe("modified: src/auth.ts")
  })

  test("invalidates scoped queries when specific scope changes", () => {
    const cache = new ObservationCache()
    cache.set("rg foo", "packages/core", "rev1", "result core")
    cache.set("rg foo", "packages/client", "rev1", "result client")

    cache.invalidateScope("packages/core")

    expect(cache.get("rg foo", "packages/core", "rev1")).toBeUndefined()
    expect(cache.get<string>("rg foo", "packages/client", "rev1")).toBe("result client")
  })

  test("tracks search coverage records and calculates efficiency metrics", () => {
    const cache = new ObservationCache()
    const coverage = {
      query: "authenticateWithCert",
      scopes: ["defining_repo", "local_callers"],
      queryVariants: ["authenticateWithCert", "authWithCert"],
      resultCount: 0,
      excludedScopes: [{ scope: "build/dist", reason: "build output" }],
      timestamp: Date.now(),
    }

    cache.trackCoverage(coverage)
    expect(cache.getCoverageHistory().length).toBe(1)
    expect(cache.getCoverageHistory()[0].query).toBe("authenticateWithCert")

    cache.set("q1", "s1", "r1", "res1")
    cache.get("q1", "s1", "r1")
    cache.get("q1", "s1", "r1")

    const metrics = cache.getMetrics()
    expect(metrics.cachedHits).toBe(2)
    expect(metrics.estimatedTokensSaved).toBe(500)
    expect(metrics.hitRate).toBe(1.0)
  })
})
