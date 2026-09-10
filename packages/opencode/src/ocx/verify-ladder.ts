import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Effect } from "effect"
import type { VerificationEvidence } from "./evidence-ledger"
import type { CheckKind, LedgerEntry } from "./ledger"
import { VerificationPlanner } from "./verification-planner"

export type LadderOutcome = "passed" | "failed" | "skipped"

export type CheckResult = {
  readonly kind: CheckKind
  readonly command?: string
  readonly cwd?: string
  readonly outcome: LadderOutcome
  readonly durationMs?: number
}

export type RunCommandInput = { command: string; cwd: string; timeoutMs: number; kind: CheckKind }
export type RunCommandResult = { outcome: "passed" | "failed" | "skipped"; durationMs: number }
export type RunCommand = (input: RunCommandInput) => RunCommandResult
export type EffectRunCommand = (input: RunCommandInput) => Effect.Effect<RunCommandResult>

export type LadderOptions = {
  readonly changed: readonly string[]
  readonly cwd: string
  readonly budgetMs?: number
  readonly exec?: RunCommand
  readonly clock?: () => number
}

export type LadderRun = {
  readonly results: readonly CheckResult[]
  readonly wallMs: number
}

const DEFAULT_BUDGET_MS = 60_000
const KIND_TIMEOUTS: Record<CheckKind, number> = {
  lint: 20_000,
  typecheck: 40_000,
  build: 60_000,
  test: 60_000,
}
const LOCK_RUNNERS: [string, string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
]
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$/
const LADDER_ORDER: readonly CheckKind[] = ["lint", "typecheck", "test", "build"]

function runnerFor(dir: string): string {
  let current = dir
  for (let depth = 0; depth < 8 && current !== dirname(current); depth++) {
    for (const [lock, runner] of LOCK_RUNNERS)
      if (existsSync(join(current, lock))) return runner
    current = dirname(current)
  }
  return "npm"
}

function nearestPackage(startDir: string, cwd: string): string | undefined {
  let current = startDir.startsWith("/") ? startDir : join(cwd, startDir)
  if (!existsSync(current)) return undefined
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(current, "package.json"))) return current
    if (current === cwd || current === dirname(current)) break
    current = dirname(current)
  }
  if (existsSync(join(cwd, "package.json"))) return cwd
  return undefined
}

type ScriptSet = { typecheck?: string; lint?: string; test?: string; build?: string }

function overrideCommands(cwd: string): ScriptSet | undefined {
  const path = join(cwd, ".ocx", "checks.json")
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const pick = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
    const commands: ScriptSet = {}
    const typecheck = pick(parsed.typecheck)
    const lint = pick(parsed.lint)
    const test = pick(parsed.test)
    const build = pick(parsed.build)
    if (typecheck || lint || test || build)
      return { ...(typecheck ? { typecheck } : {}), ...(lint ? { lint } : {}), ...(test ? { test } : {}), ...(build ? { build } : {}) }
    return undefined
  } catch {
    return undefined
  }
}

export function hasTestEvidence(
  changed: readonly string[],
  readFileSafe: (path: string) => string | undefined,
): boolean {
  const tryRead = (path: string): boolean => readFileSafe(path) !== undefined
  for (const path of changed) {
    if (TEST_PATH.test(path)) return true
    if (!/\.(ts|tsx|js|jsx|mjs|py|kt|java)$/.test(path)) continue
    const lastSlash = path.lastIndexOf("/")
    const dir = lastSlash === -1 ? "." : path.slice(0, lastSlash)
    const base = lastSlash === -1 ? path : path.slice(lastSlash + 1)
    const stem = base.replace(/\.[^.]+$/, "")
    const siblings = [
      `${dir}/${stem}.test.ts`,
      `${dir}/${stem}.test.tsx`,
      `${dir}/${stem}.spec.ts`,
      `${dir}/${stem}_test.py`,
      `${dir}/${stem}.test.js`,
    ]
    const nested = [`tests/${stem}.test.ts`, `test/${stem}.test.ts`]
    for (const candidate of [...siblings, ...nested.map((tail) => `${dir}/${tail}`)])
      if (tryRead(candidate)) return true
  }
  return false
}

export function planChecks(input: LadderOptions): Map<CheckKind, string> {
  const codePaths = input.changed.filter((path) => /\.(ts|tsx|js|jsx|mjs|py|css|html?)$/.test(path))
  if (input.changed.length === 0) return new Map()
  const overrides = overrideCommands(input.cwd)
  const firstChangedPath = codePaths[0] ?? input.changed[0]
  if (!firstChangedPath) return new Map()
  const firstChangedDir = dirname(firstChangedPath)
  const rootPkg = nearestPackage(firstChangedDir, input.cwd)
  if (!rootPkg) {
    if (!overrides) return new Map()
    return new Map(LADDER_ORDER.flatMap((kind) => (overrides[kind] ? ([[kind, overrides[kind]]] as [CheckKind, string][]) : [])))
  }

  let scripts: Record<string, unknown> = {}
  try {
    scripts = JSON.parse(readFileSync(join(rootPkg, "package.json"), "utf8"))["scripts"] ?? {}
  } catch {
    scripts = {}
  }
  const scriptOf = (kind: string): string | undefined =>
    typeof scripts[kind] === "string" && (scripts[kind] as string).trim()
      ? `${runnerFor(rootPkg)} run ${kind}`
      : undefined
  const wantsTests =
    hasTestEvidence(codePaths, (candidate) => {
      const full = candidate.startsWith("/") ? candidate : join(input.cwd, candidate)
      try {
        return readFileSync(full, "utf8")
      } catch {
        return undefined
      }
    }) || input.changed.some((path) => TEST_PATH.test(path))
  return plannedMap(VerificationPlanner.plan({
    changedPaths: input.changed,
    commandByKind: {
      lint: overrides?.lint ?? scriptOf("lint"),
      typecheck: overrides?.typecheck ?? scriptOf("typecheck"),
      ...(wantsTests ? { test: overrides?.test ?? scriptOf("test") } : {}),
      build: overrides?.build ?? scriptOf("build"),
    },
    testEvidence: wantsTests,
  }))
}

function plannedMap(plan: VerificationPlanner.Plan): Map<CheckKind, string> {
  return new Map(
    plan.checks.flatMap((check) => (check.command ? ([[check.kind, check.command]] as [CheckKind, string][]) : [])),
  )
}

function plannedChecks(input: Pick<LadderOptions, "changed" | "cwd">): Map<CheckKind, string | undefined> {
  const available = planChecks(input)
  const checks = new Map<CheckKind, string | undefined>(
    VerificationPlanner.plan({
      changedPaths: input.changed,
      testEvidence: input.changed.some((path) => TEST_PATH.test(path)),
    }).checks.map((check) => [check.kind, undefined]),
  )
  for (const [kind, command] of available) checks.set(kind, command)
  return checks
}

export function runVerifyLadder(input: LadderOptions): LadderRun {
  const exec = input.exec
  const clock = input.clock ?? (() => Date.now())
  const startedAt = clock()
  const remaining = () => Math.max(0, (input.budgetMs ?? DEFAULT_BUDGET_MS) - (clock() - startedAt))
  const results: CheckResult[] = []
  const checks = plannedChecks(input)
  for (const [kind, command] of checks) {
    if (!command || !exec) {
      results.push({ kind, outcome: "skipped" })
      continue
    }
    const budgetLeft = remaining()
    if (budgetLeft <= 1000) {
      results.push({ kind, outcome: "skipped", command })
      continue
    }
    const outcome = exec({ command, cwd: input.cwd, timeoutMs: Math.min(KIND_TIMEOUTS[kind], budgetLeft), kind })
    results.push({ kind, command, cwd: input.cwd, outcome: outcome.outcome, durationMs: outcome.durationMs })
  }
  return { results, wallMs: clock() - startedAt }
}

export function runVerifyLadderEffect(
  input: Omit<LadderOptions, "exec"> & { readonly exec: EffectRunCommand },
): Effect.Effect<LadderRun> {
  return Effect.gen(function* () {
    const clock = input.clock ?? (() => Date.now())
    const startedAt = clock()
    const remaining = () => Math.max(0, (input.budgetMs ?? DEFAULT_BUDGET_MS) - (clock() - startedAt))
    const results: CheckResult[] = []
    for (const [kind, command] of plannedChecks(input)) {
      if (!command) {
        results.push({ kind, outcome: "skipped" })
        continue
      }
      const budgetLeft = remaining()
      if (budgetLeft <= 1000) {
        results.push({ kind, outcome: "skipped", command })
        continue
      }
      const outcome = yield* input.exec({
        command,
        cwd: input.cwd,
        timeoutMs: Math.min(KIND_TIMEOUTS[kind], budgetLeft),
        kind,
      })
      results.push({ kind, command, cwd: input.cwd, outcome: outcome.outcome, durationMs: outcome.durationMs })
    }
    return { results, wallMs: clock() - startedAt }
  })
}

export function synthEntries(results: readonly CheckResult[]): LedgerEntry[] {
  return results.flatMap((result) =>
    result.outcome !== "skipped" && result.command
      ? [{ kind: "command" as const, command: result.command, outcome: result.outcome, check: result.kind }]
      : [],
  )
}

export function synthEvidence(results: readonly CheckResult[]): VerificationEvidence[] {
  return results.flatMap((result) =>
    result.outcome !== "skipped" && result.command
      ? [
          {
            checkId: result.kind,
            kind:
              result.kind === "test"
                ? ("test" as const)
                : result.kind === "typecheck"
                  ? ("typecheck" as const)
                  : result.kind === "lint"
                    ? ("lint" as const)
                    : ("semantic" as const),
            target: result.command,
            passed: result.outcome === "passed",
            timestamp: Date.now(),
          },
        ]
      : [],
  )
}

export function ladderUnverifiable(results: readonly CheckResult[]): boolean {
  return results.length === 0 || results.every((result) => result.outcome === "skipped")
}

export * as VerifyLadder from "./verify-ladder"
