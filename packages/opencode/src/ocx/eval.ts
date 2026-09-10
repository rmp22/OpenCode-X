import type { CheckKind } from "./ledger"

export type ScoringRules = {
  readonly incompleteTask: number
  readonly instructionViolation: number
  readonly missedAcceptance: number
  readonly unnecessaryEdit: number
  readonly unrelatedRefactor: number
  readonly testFailure: number
  readonly falseCompletion: number
  readonly repeatedToolCall: number
  readonly repeatedExploration: number
  readonly failedApproach: number
  readonly staleMemory: number
  readonly reviewCorrection: number
  readonly regression: number
}

export type Fixture = {
  readonly id: string
  readonly name: string
  readonly repositoryFixture: string
  readonly startingRevision: string
  readonly request: string
  readonly hardConstraints: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly expectedDomains: readonly string[]
  readonly expectedPaths: readonly string[]
  readonly requiredVerification: readonly CheckKind[]
  readonly prohibitedChanges: readonly string[]
  readonly scoring: ScoringRules
}

export type Observation = {
  readonly completed: boolean
  readonly instructionViolations: number
  readonly missedAcceptanceCriteria: number
  readonly unnecessaryEdits: number
  readonly unrelatedRefactors: number
  readonly testFailures: number
  readonly falseCompletion: boolean
  readonly prohibitedChanges: number
  readonly repeatedToolCalls: number
  readonly repeatedExploration: number
  readonly failedApproaches: number
  readonly recoveries: number
  readonly tokenUsage: number
  readonly cost: number
  readonly timeMs: number
  readonly ownerReuse: boolean
  readonly memoryRetrievalUseful: boolean
  readonly staleMemoryIncidents: number
  readonly reviewCorrections: number
  readonly regressions: number
  readonly changedPaths: readonly string[]
  readonly verification: readonly { readonly kind: CheckKind; readonly outcome: "passed" | "failed" | "unknown" }[]
}

export type RunMetadata = {
  readonly policyVersion: string
  readonly featureFlags: readonly string[]
  readonly model?: string
  readonly provider?: string
  readonly variant?: string
  readonly ocxVersion?: string
  readonly toolSummary?: string
  readonly repositoryRevision?: string
  readonly ablationID?: string
}

export type RunRecord = {
  readonly runID: string
  readonly fixtureID: string
  readonly repositoryFixture: string
  readonly startingRevision: string
  readonly actualRevision?: string
  readonly metadata: RunMetadata
  readonly status: "completed" | "failed"
  readonly result: Result
  readonly error?: string
  readonly startedAt: number
  readonly completedAt: number
}

export type Result = {
  readonly fixtureID: string
  readonly success: boolean
  readonly score: number
  readonly reasons: readonly string[]
  readonly observation: Observation
}

export type Aggregate = {
  readonly runs: number
  readonly successes: number
  readonly averageScore: number
  readonly averageRecoveries: number
  readonly ownerReuseRate: number
  readonly usefulMemoryRate: number
  readonly totalRegressions: number
}

const MAX_TEXT = 400
const MAX_LIST = 24
const MAX_PATHS = 64
const SCORE_MAX = 100
const MAX_CHANGED_PATHS = 128
const MAX_ERROR = 2_000

export const DEFAULT_SCORING: ScoringRules = {
  incompleteTask: 40,
  instructionViolation: 20,
  missedAcceptance: 20,
  unnecessaryEdit: 3,
  unrelatedRefactor: 10,
  testFailure: 15,
  falseCompletion: 25,
  repeatedToolCall: 1,
  repeatedExploration: 2,
  failedApproach: 3,
  staleMemory: 8,
  reviewCorrection: 4,
  regression: 25,
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.replaceAll(/\s+/g, " ").trim()
  return result.length > 0 && result.length <= MAX_TEXT ? result : undefined
}

function list(value: unknown, max = MAX_LIST): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length > max) return undefined
  const result: string[] = []
  for (const item of value) {
    const itemText = text(item)
    if (!itemText) return undefined
    result.push(itemText)
  }
  return result
}

function checks(value: unknown): CheckKind[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: CheckKind[] = []
  for (const item of value) {
    if (item !== "lint" && item !== "typecheck" && item !== "test" && item !== "build") return undefined
    if (!result.includes(item)) result.push(item)
  }
  return result.length <= MAX_LIST ? result : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function count(value: number | undefined): number {
  return value === undefined ? 0 : Math.max(0, Math.min(1_000_000, Math.floor(value)))
}

function changedPaths(value: readonly string[] | undefined): string[] {
  if (!value) return []
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].slice(
    0,
    MAX_CHANGED_PATHS,
  )
}

function verification(value: Observation["verification"] | undefined): Observation["verification"] {
  if (!value) return []
  return value.filter(
    (item) =>
      (item.kind === "lint" || item.kind === "typecheck" || item.kind === "test" || item.kind === "build") &&
      (item.outcome === "passed" || item.outcome === "failed" || item.outcome === "unknown"),
  )
}

export function normalizeObservation(input: Partial<Observation> = {}, paths = input.changedPaths): Observation {
  return {
    completed: input.completed === true,
    instructionViolations: count(input.instructionViolations),
    missedAcceptanceCriteria: count(input.missedAcceptanceCriteria),
    unnecessaryEdits: count(input.unnecessaryEdits),
    unrelatedRefactors: count(input.unrelatedRefactors),
    testFailures: count(input.testFailures),
    falseCompletion: input.falseCompletion === true,
    prohibitedChanges: count(input.prohibitedChanges),
    repeatedToolCalls: count(input.repeatedToolCalls),
    repeatedExploration: count(input.repeatedExploration),
    failedApproaches: count(input.failedApproaches),
    recoveries: count(input.recoveries),
    tokenUsage: count(input.tokenUsage),
    cost: input.cost === undefined || !Number.isFinite(input.cost) ? 0 : Math.max(0, Math.min(1_000_000, input.cost)),
    timeMs: count(input.timeMs),
    ownerReuse: input.ownerReuse === true,
    memoryRetrievalUseful: input.memoryRetrievalUseful === true,
    staleMemoryIncidents: count(input.staleMemoryIncidents),
    reviewCorrections: count(input.reviewCorrections),
    regressions: count(input.regressions),
    changedPaths: changedPaths(paths),
    verification: verification(input.verification),
  }
}

function metadata(value: unknown): RunMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as globalThis.Record<string, unknown>
  const policyVersion = text(record.policyVersion)
  const featureFlags = list(record.featureFlags)
  if (!policyVersion || !featureFlags) return undefined
  const optionalText = (item: unknown) => (item === undefined ? undefined : text(item))
  return {
    policyVersion,
    featureFlags,
    ...(optionalText(record.model) ? { model: optionalText(record.model) } : {}),
    ...(optionalText(record.provider) ? { provider: optionalText(record.provider) } : {}),
    ...(optionalText(record.variant) ? { variant: optionalText(record.variant) } : {}),
    ...(optionalText(record.ocxVersion) ? { ocxVersion: optionalText(record.ocxVersion) } : {}),
    ...(optionalText(record.toolSummary) ? { toolSummary: optionalText(record.toolSummary) } : {}),
    ...(optionalText(record.repositoryRevision) ? { repositoryRevision: optionalText(record.repositoryRevision) } : {}),
    ...(optionalText(record.ablationID) ? { ablationID: optionalText(record.ablationID) } : {}),
  }
}

export function parseRun(value: unknown): RunRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as globalThis.Record<string, unknown>
  const runID = text(record.runID)
  const fixtureID = text(record.fixtureID)
  const repositoryFixture = text(record.repositoryFixture)
  const startingRevision = text(record.startingRevision)
  const actualRevision = record.actualRevision === undefined ? undefined : text(record.actualRevision)
  const runMetadata = metadata(record.metadata)
  const status = record.status === "completed" || record.status === "failed" ? record.status : undefined
  const resultValue = record.result
  const startedAt = number(record.startedAt)
  const completedAt = number(record.completedAt)
  if (!runID || !fixtureID || !repositoryFixture || !startingRevision || !runMetadata || !status || !resultValue || startedAt === undefined || completedAt === undefined)
    return undefined
  if (typeof resultValue !== "object" || Array.isArray(resultValue)) return undefined
  const resultRecord = resultValue as globalThis.Record<string, unknown>
  const resultFixtureID = text(resultRecord.fixtureID)
  const resultScore = resultRecord.score
  const resultSuccess = resultRecord.success
  const resultReasons = list(resultRecord.reasons)
  const resultObservation = resultRecord.observation
  if (!resultFixtureID || typeof resultSuccess !== "boolean" || typeof resultScore !== "number" || !Number.isFinite(resultScore) || !resultReasons)
    return undefined
  if (!resultObservation || typeof resultObservation !== "object" || Array.isArray(resultObservation)) return undefined
  if (resultFixtureID !== fixtureID) return undefined
  const observation = normalizeObservation(resultObservation as Partial<Observation>)
  return {
    runID,
    fixtureID,
    repositoryFixture,
    startingRevision,
    ...(actualRevision ? { actualRevision } : {}),
    metadata: runMetadata,
    status,
    result: { fixtureID: resultFixtureID, success: resultSuccess, score: Math.max(0, Math.min(SCORE_MAX, resultScore)), reasons: resultReasons, observation },
    ...(typeof record.error === "string" && record.error.length > 0 ? { error: record.error.slice(0, MAX_ERROR) } : {}),
    startedAt,
    completedAt,
  }
}

function scoring(value: unknown): ScoringRules | undefined {
  if (value === undefined) return DEFAULT_SCORING
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as globalThis.Record<string, unknown>
  const result = { ...DEFAULT_SCORING }
  for (const key of Object.keys(DEFAULT_SCORING) as (keyof ScoringRules)[]) {
    if (record[key] !== undefined && typeof record[key] !== "number") return undefined
    const valueAtKey = number(record[key])
    if (record[key] !== undefined && valueAtKey === undefined) return undefined
    if (valueAtKey !== undefined) result[key] = Math.min(100, valueAtKey)
  }
  return result
}

export function parse(value: unknown): Fixture | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as globalThis.Record<string, unknown>
  const id = typeof record.id === "string" && /^[a-z0-9][a-z0-9_-]{1,63}$/.test(record.id) ? record.id : undefined
  const name = text(record.name)
  const repositoryFixture = text(record.repositoryFixture)
  const startingRevision = text(record.startingRevision)
  const request = text(record.request)
  const hardConstraints = list(record.hardConstraints)
  const acceptanceCriteria = list(record.acceptanceCriteria)
  const expectedDomains = list(record.expectedDomains)
  const expectedPaths = record.expectedPaths === undefined ? [] : list(record.expectedPaths, MAX_PATHS)
  const requiredVerification = checks(record.requiredVerification)
  const prohibitedChanges = list(record.prohibitedChanges)
  const scoreRules = scoring(record.scoring)
  if (
    !id ||
    !name ||
    !repositoryFixture ||
    !startingRevision ||
    !request ||
    !hardConstraints ||
    !acceptanceCriteria ||
    !expectedDomains ||
    !expectedPaths ||
    !requiredVerification ||
    !prohibitedChanges ||
    !scoreRules
  )
    return undefined
  return {
    id,
    name,
    repositoryFixture,
    startingRevision,
    request,
    hardConstraints,
    acceptanceCriteria,
    expectedDomains,
    expectedPaths,
    requiredVerification,
    prohibitedChanges,
    scoring: scoreRules,
  }
}

function failedVerification(fixture: Fixture, observation: Observation): CheckKind[] {
  return fixture.requiredVerification.filter(
    (kind) => observation.verification.find((check) => check.kind === kind)?.outcome !== "passed",
  )
}

function penalty(value: number, weight: number): number {
  return Math.max(0, value) * weight
}

export function score(fixture: Fixture, observation: Observation): Result {
  const failedChecks = failedVerification(fixture, observation)
  const prohibitedPaths = fixture.prohibitedChanges.filter((path) => observation.changedPaths.includes(path))
  const reasons: string[] = []
  if (!observation.completed) reasons.push("task did not complete")
  if (failedChecks.length > 0) reasons.push(`required checks did not pass: ${failedChecks.join(", ")}`)
  if (observation.instructionViolations > 0) reasons.push(`${observation.instructionViolations} instruction violation(s)`)
  if (observation.missedAcceptanceCriteria > 0) reasons.push(`${observation.missedAcceptanceCriteria} acceptance criterion(ies) missed`)
  if (prohibitedPaths.length > 0) reasons.push(`prohibited paths changed: ${prohibitedPaths.join(", ")}`)
  if (observation.prohibitedChanges > 0) reasons.push(`${observation.prohibitedChanges} prohibited change(s) recorded`)
  if (observation.falseCompletion) reasons.push("false completion was attempted")
  if (observation.regressions > 0) reasons.push(`${observation.regressions} regression(s) recorded`)
  const raw = SCORE_MAX -
    penalty(observation.completed ? 0 : 1, fixture.scoring.incompleteTask) -
    penalty(observation.instructionViolations, fixture.scoring.instructionViolation) -
    penalty(observation.missedAcceptanceCriteria, fixture.scoring.missedAcceptance) -
    penalty(observation.unnecessaryEdits, fixture.scoring.unnecessaryEdit) -
    penalty(observation.unrelatedRefactors, fixture.scoring.unrelatedRefactor) -
    penalty(observation.testFailures, fixture.scoring.testFailure) -
    penalty(observation.falseCompletion ? 1 : 0, fixture.scoring.falseCompletion) -
    penalty(observation.repeatedToolCalls, fixture.scoring.repeatedToolCall) -
    penalty(observation.repeatedExploration, fixture.scoring.repeatedExploration) -
    penalty(observation.failedApproaches, fixture.scoring.failedApproach) -
    penalty(observation.staleMemoryIncidents, fixture.scoring.staleMemory) -
    penalty(observation.reviewCorrections, fixture.scoring.reviewCorrection) -
    penalty(observation.regressions, fixture.scoring.regression)
  const success = observation.completed && failedChecks.length === 0 && observation.instructionViolations === 0 && observation.missedAcceptanceCriteria === 0 && prohibitedPaths.length === 0 && observation.prohibitedChanges === 0 && !observation.falseCompletion && observation.regressions === 0
  return {
    fixtureID: fixture.id,
    success,
    score: Math.max(0, Math.min(SCORE_MAX, Math.round(raw))),
    reasons,
    observation,
  }
}

export function summarize(results: readonly Result[]): Aggregate {
  if (results.length === 0)
    return { runs: 0, successes: 0, averageScore: 0, averageRecoveries: 0, ownerReuseRate: 0, usefulMemoryRate: 0, totalRegressions: 0 }
  const total = results.reduce(
    (sum, result) => ({
      score: sum.score + result.score,
      recoveries: sum.recoveries + result.observation.recoveries,
      ownerReuse: sum.ownerReuse + (result.observation.ownerReuse ? 1 : 0),
      usefulMemory: sum.usefulMemory + (result.observation.memoryRetrievalUseful ? 1 : 0),
      regressions: sum.regressions + result.observation.regressions,
    }),
    { score: 0, recoveries: 0, ownerReuse: 0, usefulMemory: 0, regressions: 0 },
  )
  return {
    runs: results.length,
    successes: results.filter((result) => result.success).length,
    averageScore: Math.round(total.score / results.length),
    averageRecoveries: Math.round((total.recoveries / results.length) * 100) / 100,
    ownerReuseRate: Math.round((total.ownerReuse / results.length) * 100) / 100,
    usefulMemoryRate: Math.round((total.usefulMemory / results.length) * 100) / 100,
    totalRegressions: total.regressions,
  }
}

export * from "./eval/types"
export * from "./eval/harness"
export * from "./eval/ablation-gate"
export * as Eval from "./eval"
