import { execFileSync } from "node:child_process"
import { cp, mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Cause, Effect, Exit } from "effect"
import { Eval } from "./eval"
import type { MeasurementProvenance } from "./eval/types"
import { OCXDb } from "./ocx-db"

export type ExecutorInput = {
  readonly fixture: Eval.Fixture
  readonly workdir: string
  readonly runID: string
  readonly metadata: Eval.RunMetadata
}

export type Executor<R = never> = (input: ExecutorInput) => Effect.Effect<Partial<Eval.Observation>, unknown, R>

export type RunInput<R = never> = {
  readonly fixture: Eval.Fixture
  readonly executor: Executor<R>
  readonly store?: OCXDb.Store
  readonly metadata?: Partial<Eval.RunMetadata>
}

export type Ablation = {
  readonly id: string
  readonly featureFlags: readonly string[]
}

export type AblationInput<R = never> = {
  readonly fixture: Eval.Fixture
  readonly executor: Executor<R>
  readonly variants: readonly Ablation[]
  readonly store?: OCXDb.Store
  readonly metadata?: Partial<Eval.RunMetadata>
}

const DEFAULT_POLICY_VERSION = "ocx-eval-v1"
const MAX_ERROR = 2_000

export function run<R>(input: RunInput<R>): Effect.Effect<Eval.RunRecord, unknown, R> {
  return Effect.gen(function* () {
    const store = input.store ?? (yield* OCXDb.shared)
    const source = yield* sourceDirectory(input.fixture.repositoryFixture)
    const runID = `eval_${crypto.randomUUID().replaceAll("-", "")}`
    const startedAt = Date.now()
    const metadata: Eval.RunMetadata = {
      policyVersion: input.metadata?.policyVersion ?? DEFAULT_POLICY_VERSION,
      featureFlags: [...new Set(input.metadata?.featureFlags ?? [])].slice(0, 32),
      ...(input.metadata?.model ? { model: input.metadata.model } : {}),
      ...(input.metadata?.provider ? { provider: input.metadata.provider } : {}),
      ...(input.metadata?.variant ? { variant: input.metadata.variant } : {}),
      ...(input.metadata?.ocxVersion ? { ocxVersion: input.metadata.ocxVersion } : {}),
      ...(input.metadata?.toolSummary ? { toolSummary: input.metadata.toolSummary.slice(0, 400) } : {}),
      ...(input.metadata?.ablationID ? { ablationID: input.metadata.ablationID } : {}),
    }
    return yield* Effect.acquireUseRelease(
      temporaryWorkspace(source),
      ({ root, workdir }) =>
        Effect.gen(function* () {
          const beforeRevision = gitRevision(workdir)
          const exit = yield* Effect.exit(input.executor({ fixture: input.fixture, workdir, runID, metadata }))
          const afterRevision = gitRevision(workdir)
          const changed = gitChangedPaths(workdir)
          const observation = Eval.normalizeObservation(
            Exit.isSuccess(exit) ? exit.value : {},
            changed ?? (Exit.isSuccess(exit) ? exit.value.changedPaths : undefined),
          )
          const result = Eval.score(input.fixture, observation)
          const record: Eval.RunRecord = {
            runID,
            fixtureID: input.fixture.id,
            repositoryFixture: source,
            startingRevision: input.fixture.startingRevision,
            ...(afterRevision ? { actualRevision: afterRevision } : {}),
            metadata: {
              ...metadata,
              ...(beforeRevision ? { repositoryRevision: beforeRevision } : {}),
            },
            status: Exit.isSuccess(exit) ? "completed" : "failed",
            result,
            ...(Exit.isFailure(exit) ? { error: Cause.pretty(exit.cause).slice(0, MAX_ERROR) } : {}),
            startedAt,
            completedAt: Date.now(),
          }
          store.recordEvaluation(record)
          return record
        }),
      ({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    )
  })
}

export function runAblations<R>(input: AblationInput<R>): Effect.Effect<readonly Eval.RunRecord[], unknown, R> {
  return Effect.forEach(
    input.variants,
    (variant) =>
      run({
        fixture: input.fixture,
        executor: input.executor,
        store: input.store,
        metadata: {
          ...input.metadata,
          ablationID: variant.id,
          featureFlags: [...new Set([...(input.metadata?.featureFlags ?? []), ...variant.featureFlags])],
          toolSummary: input.metadata?.toolSummary
            ? `${input.metadata.toolSummary} ablation=${variant.id}`
            : `ablation=${variant.id}`,
        },
      }),
    { concurrency: 1 },
  )
}

function sourceDirectory(value: string): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const resolved = path.resolve(value)
      const info = await stat(resolved)
      if (!info.isDirectory()) throw new Error(`Evaluation fixture is not a directory: ${value}`)
      return resolved
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function temporaryWorkspace(source: string): Effect.Effect<{ root: string; workdir: string }, Error> {
  return Effect.tryPromise({
    try: async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "opencode-eval-"))
      const workdir = path.join(root, "repository")
      try {
        await cp(source, workdir, { recursive: true, force: true })
      } catch (error) {
        await rm(root, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return { root, workdir }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function gitRevision(workdir: string): string | undefined {
  try {
    return execFileSync("git", ["-C", workdir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined
  } catch {
    return undefined
  }
}

function gitChangedPaths(workdir: string): string[] | undefined {
  try {
    return execFileSync("git", ["-C", workdir, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
  } catch {
    return undefined
  }
}

export function compareAblations(baselineRecord: Eval.RunRecord, treatmentRecord: Eval.RunRecord): {
  readonly modelMatch: boolean
  readonly delta: number
  readonly isEmpirical: boolean
  readonly provenance: MeasurementProvenance
} {
  const modelMatch = baselineRecord.metadata?.model === treatmentRecord.metadata?.model && Boolean(baselineRecord.metadata?.model)
  const baselineScore = baselineRecord.result.score ?? 0
  const treatmentScore = treatmentRecord.result.score ?? 0
  const delta = treatmentScore - baselineScore
  const provenance: MeasurementProvenance = modelMatch
    ? {
        kind: "empirical",
        runId: treatmentRecord.runID,
        date: new Date(treatmentRecord.completedAt).toISOString(),
        sampleCount: 1,
      }
    : { kind: "unmeasured" }
  const comparison = {
    modelMatch,
    delta,
    isEmpirical: modelMatch,
    provenance,
  }
  return comparison
}

export * as EvalRunner from "./eval-runner"
