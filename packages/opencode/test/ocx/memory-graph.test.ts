import { describe, expect, test } from "bun:test"
import { createCodeGraph } from "@/ocx/memory/graph"

describe("CodeGraph and Blast Radius Engine", () => {
  test("registers nodes and traces direct and transitive dependents", () => {
    const graph = createCodeGraph()

    graph.addNode({ id: "auth:login", name: "login", file: "src/auth/login.ts", type: "function" })
    graph.addNode({ id: "auth:token", name: "verifyToken", file: "src/auth/token.ts", type: "function" })
    graph.addNode({ id: "api:handler", name: "handleRequest", file: "src/api/handler.ts", type: "function" })
    graph.addNode({ id: "test:auth", name: "authTest", file: "test/auth.test.ts", type: "function" })

    graph.addEdge({ source: "auth:login", target: "auth:token", type: "calls" })
    graph.addEdge({ source: "api:handler", target: "auth:login", type: "calls" })
    graph.addEdge({ source: "test:auth", target: "auth:login", type: "calls" })

    const tokenDependents = graph.getDirectDependents("auth:token")
    expect(tokenDependents).toContain("auth:login")

    const transitive = graph.getTransitiveDependents("auth:token")
    expect(transitive).toContain("auth:login")
    expect(transitive).toContain("api:handler")
    expect(transitive).toContain("test:auth")
  })

  test("computes blast radius from changed files", () => {
    const graph = createCodeGraph()

    graph.addNode({ id: "db:client", name: "dbClient", file: "src/db/client.ts", type: "variable" })
    graph.addNode({ id: "user:repo", name: "userRepo", file: "src/repo/user.ts", type: "class" })
    graph.addNode({ id: "api:user", name: "userRouter", file: "src/api/user.ts", type: "function" })
    graph.addNode({ id: "test:user", name: "userTest", file: "test/user.test.ts", type: "function" })

    graph.addEdge({ source: "user:repo", target: "db:client", type: "depends_on" })
    graph.addEdge({ source: "api:user", target: "user:repo", type: "calls" })
    graph.addEdge({ source: "test:user", target: "user:repo", type: "calls" })

    const blast = graph.computeBlastRadius(["src/db/client.ts"])

    expect(blast.changedFiles).toEqual(["src/db/client.ts"])
    expect(blast.directlyAffected).toContain("src/repo/user.ts")
    expect(blast.transitiveAffected).toContain("src/repo/user.ts")
    expect(blast.transitiveAffected).toContain("src/api/user.ts")
    expect(blast.transitiveAffected).toContain("test/user.test.ts")
    expect(blast.affectedTests).toContain("test/user.test.ts")
    expect(blast.impactScore).toBeGreaterThan(0)
  })

  test("computes GraphRank centrality", () => {
    const graph = createCodeGraph()

    graph.addNode({ id: "core:util", name: "util", file: "src/core/util.ts", type: "function" })
    graph.addNode({ id: "mod:a", name: "modA", file: "src/mod/a.ts", type: "function" })
    graph.addNode({ id: "mod:b", name: "modB", file: "src/mod/b.ts", type: "function" })

    graph.addEdge({ source: "mod:a", target: "core:util", type: "calls" })
    graph.addEdge({ source: "mod:b", target: "core:util", type: "calls" })

    const ranks = graph.computeGraphRank(10)
    const utilRank = ranks.get("core:util") ?? 0
    const aRank = ranks.get("mod:a") ?? 0

    expect(utilRank).toBeGreaterThan(aRank)
  })
})
