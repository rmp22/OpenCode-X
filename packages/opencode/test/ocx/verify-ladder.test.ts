import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { VerifyLadder } from "@/ocx/verify-ladder"

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ocx-ladder-"))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

const PKG_JSON = JSON.stringify({
  scripts: { lint: "eslint .", typecheck: "tsc --noEmit", test: "vitest run" },
})

describe("planChecks", () => {
  test("returns empty plan when nothing code-shaped changed", () => {
    const root = makeRepo({ "package.json": PKG_JSON })
    try {
      expect(VerifyLadder.planChecks({ changed: ["docs/readme.md"], cwd: root }).size).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("discovers scripts from nearest package with lockfile runner and skips tests without test evidence", () => {
    const root = makeRepo({
      "bun.lock": "",
      "packages/app/package.json": PKG_JSON,
      "packages/app/src/a.ts": "export const a = 1\n",
    })
    try {
      const planned = VerifyLadder.planChecks({ changed: ["packages/app/src/a.ts"], cwd: root })
      expect(planned.get("lint")).toBe("bun run lint")
      expect(planned.get("typecheck")).toBe("bun run typecheck")
      expect(planned.has("test")).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("adds test command when a co-located test file exists", () => {
    const root = makeRepo({
      "bun.lock": "",
      "pkg/package.json": PKG_JSON,
      "pkg/src/a.ts": "export const a = 1\n",
      "pkg/src/a.test.ts": "import { test } from 'bun:test'\n",
    })
    try {
      expect(VerifyLadder.planChecks({ changed: ["pkg/src/a.ts"], cwd: root }).get("test")).toBe("bun run test")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("checks.json override wins over package scripts", () => {
    const root = makeRepo({
      "bun.lock": "",
      "package.json": PKG_JSON,
      ".ocx/checks.json": JSON.stringify({ typecheck: "bun x tsc", lint: "oxlint ." }),
      "src/a.ts": "export const a = 1\n",
    })
    try {
      const planned = VerifyLadder.planChecks({ changed: ["src/a.ts"], cwd: root })
      expect(planned.get("typecheck")).toBe("bun x tsc")
      expect(planned.get("lint")).toBe("oxlint .")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("plans a build when package metadata changes and a build script exists", () => {
    const root = makeRepo({
      "bun.lock": "",
      "package.json": JSON.stringify({ scripts: { build: "vite build" } }),
    })
    try {
      expect(VerifyLadder.planChecks({ changed: ["package.json"], cwd: root }).get("build")).toBe("bun run build")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("records source checks as skipped when no command can be discovered", () => {
    const root = makeRepo({ "src/a.ts": "export const a = 1\n" })
    try {
      const ran = VerifyLadder.runVerifyLadder({ changed: ["src/a.ts"], cwd: root, exec: () => { throw new Error("must not run") } })
      expect(ran.results.map((result) => [result.kind, result.outcome])).toEqual([
        ["lint", "skipped"],
        ["typecheck", "skipped"],
      ])
      expect(VerifyLadder.ladderUnverifiable(ran.results)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("does not execute a default process when no executor is injected", () => {
    const root = makeRepo({
      "bun.lock": "",
      "package.json": PKG_JSON,
      "src/a.ts": "export const a = 1\n",
    })
    try {
      const ran = VerifyLadder.runVerifyLadder({ changed: ["src/a.ts"], cwd: root })
      expect(ran.results.map((result) => [result.kind, result.outcome])).toEqual([
        ["lint", "skipped"],
        ["typecheck", "skipped"],
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("runVerifyLadder", () => {
  const fakeChanged = ["src/a.ts"]

  function repoWithOverride(order: string[]): string {
    return makeRepo({
      ".ocx/checks.json": JSON.stringify(Object.fromEntries(order.map((kind) => [kind, `${kind}-cmd`]))),
      "src/a.ts": "export const a = 1\n",
      "src/a.test.ts": "import { test } from 'bun:test'\n",
    })
  }

  test("runs each planned check sequentially with bounded timeouts", () => {
    const root = repoWithOverride(["lint", "typecheck"])
    try {
      const seen: string[] = []
      const timings: number[] = []
      const exec: VerifyLadder.RunCommand = ({ command, timeoutMs }) => {
        seen.push(command)
        timings.push(timeoutMs)
        return { outcome: "passed", durationMs: 5 }
      }
      const ran = VerifyLadder.runVerifyLadder({ changed: fakeChanged, cwd: root, exec })
      expect(seen).toEqual(["lint-cmd", "typecheck-cmd"])
      expect(ran.results.every((result) => result.outcome === "passed")).toBe(true)
      expect(timings.every((ms) => ms <= 40_000)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("classifies nonzero exit as failed and keeps failed before later entries", () => {
    const root = repoWithOverride(["lint", "typecheck"])
    try {
      let first = true
      const exec: VerifyLadder.RunCommand = ({ command }) => {
        if (first) {
          first = false
          void command
          return { outcome: "failed", durationMs: 1 }
        }
        return { outcome: "passed", durationMs: 1 }
      }
      const ran = VerifyLadder.runVerifyLadder({ changed: fakeChanged, cwd: root, exec })
      expect(ran.results.map((result) => result.outcome)).toEqual(["failed", "passed"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("keeps mixed source, test, and package changes in planner order", () => {
    const root = makeRepo({
      "bun.lock": "",
      "package.json": JSON.stringify({ scripts: { lint: "lint", typecheck: "types", test: "tests", build: "build" } }),
      "src/a.ts": "export const a = 1\n",
      "src/a.test.ts": "import { test } from 'bun:test'\n",
    })
    try {
      const seen: string[] = []
      VerifyLadder.runVerifyLadder({
        changed: ["src/a.ts", "src/a.test.ts", "package.json"],
        cwd: root,
        exec: ({ command }) => {
          seen.push(command)
          return { outcome: "passed", durationMs: 1 }
        },
      })
      expect(seen).toEqual(["bun run lint", "bun run typecheck", "bun run test", "bun run build"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("budget exhaustion marks remaining checks skipped instead of executing them", () => {
    const root = repoWithOverride(["lint", "typecheck"])
    try {
      let calls = 0
      const exec: VerifyLadder.RunCommand = () => {
        calls++
        return { outcome: "passed", durationMs: 5 }
      }
      const ticks = [0, 0, 59_500]
      let idx = -1
      const ran = VerifyLadder.runVerifyLadder({
        changed: fakeChanged,
        cwd: root,
        exec,
        budgetMs: 60_000,
        clock: () => ticks[++idx] ?? 59_500,
      })
      expect(calls).toBe(1)
      expect(ran.results[0]!.outcome).toBe("passed")
      expect(ran.results[1]!.outcome).toBe("skipped")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("synthEntries", () => {
  test("maps executed results into ledger vocabulary and drops skipped", () => {
    const entries = VerifyLadder.synthEntries([
      { kind: "typecheck", command: "bun x tsc", outcome: "passed", durationMs: 10 },
      { kind: "lint", command: "oxlint .", outcome: "skipped" },
      { kind: "test", command: "bun test", outcome: "failed", durationMs: 20 },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ kind: "command", command: "bun x tsc", outcome: "passed", check: "typecheck" })
    expect(entries[1]).toEqual({ kind: "command", command: "bun test", outcome: "failed", check: "test" })
  })

  test("ladderUnverifiable flags empty and all-skipped runs only", () => {
    expect(VerifyLadder.ladderUnverifiable([])).toBe(true)
    expect(
      VerifyLadder.ladderUnverifiable([{ kind: "lint", command: "oxlint .", outcome: "skipped" }]),
    ).toBe(true)
    expect(
      VerifyLadder.ladderUnverifiable([{ kind: "lint", command: "oxlint .", outcome: "passed", durationMs: 1 }]),
    ).toBe(false)
  })
})
