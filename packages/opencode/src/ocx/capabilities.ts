export const CAPABILITIES = [
  "instructionAdherence",
  "planning",
  "repositoryNavigation",
  "toolUse",
  "longHorizonPersistence",
  "debugging",
  "contextEfficiency",
  "architectureJudgment",
  "selfVerification",
  "stopEarlyTendency",
  "overexplorationTendency",
  "hallucinatedConfigurationTendency",
  "repeatedActionTendency",
] as const

export type Capability = (typeof CAPABILITIES)[number]
export type Level = "light" | "standard" | "strong"
export type CapabilityScores = { readonly [key in Capability]: number }

export type Profile = {
  readonly subjectID: string
  readonly capabilities: CapabilityScores
  readonly samples: number
  readonly updatedAt: number
}

export type Evidence = {
  readonly values: Partial<Record<Capability, number>>
  readonly samples?: number
}

export type TaskNeeds = {
  readonly capabilities: Partial<Record<Capability, number>>
}

export type Candidate = {
  readonly id: string
  readonly profile: Profile
}

export type Match = {
  readonly candidate: Candidate
  readonly score: number
  readonly gaps: readonly Capability[]
}

export type GuardPolicy = {
  readonly planning: Level
  readonly review: Level
  readonly completion: Level
  readonly context: Level
}

const MAX_ID = 160
const MAX_SAMPLES = 1_000_000
const SCORE_MIN = 0
const SCORE_MAX = 1
const MIN_STANDARD = 0.45
const MIN_LIGHT = 0.75
const RISK_CAPABILITIES = new Set<Capability>([
  "stopEarlyTendency",
  "overexplorationTendency",
  "hallucinatedConfigurationTendency",
  "repeatedActionTendency",
])

function subjectID(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.trim()
  return result.length > 0 && result.length <= MAX_ID && !result.includes("===") ? result : undefined
}

function score(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= SCORE_MIN && value <= SCORE_MAX ? value : undefined
}

function samples(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SAMPLES ? value : undefined
}

function parseScores(value: unknown): CapabilityScores | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as globalThis.Record<string, unknown>
  const result = {} as Record<Capability, number>
  for (const capability of CAPABILITIES) {
    const valueAtCapability = score(record[capability])
    if (valueAtCapability === undefined) return undefined
    result[capability] = valueAtCapability
  }
  return result
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function strength(value: number): Level {
  if (value < MIN_STANDARD) return "strong"
  if (value < MIN_LIGHT) return "standard"
  return "light"
}

function safer(value: number): number {
  return SCORE_MAX - value
}

export function parse(value: unknown): Profile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as globalThis.Record<string, unknown>
  const id = subjectID(record.subjectID)
  const capabilities = parseScores(record.capabilities)
  const sampleCount = samples(record.samples)
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : undefined
  if (!id || !capabilities || sampleCount === undefined || updatedAt === undefined) return undefined
  return { subjectID: id, capabilities, samples: sampleCount, updatedAt }
}

export function update(profile: Profile, evidence: Evidence, now = Date.now()): Profile {
  const weight = samples(evidence.samples ?? 1)
  if (weight === undefined || weight === 0) return profile
  const values = {} as Record<Capability, number>
  let observed = 0
  for (const capability of CAPABILITIES) {
    const next = score(evidence.values[capability])
    if (next === undefined) {
      values[capability] = profile.capabilities[capability]
      continue
    }
    values[capability] = (profile.capabilities[capability] * profile.samples + next * weight) / (profile.samples + weight)
    observed++
  }
  if (observed === 0) return profile
  return {
    subjectID: profile.subjectID,
    capabilities: values,
    samples: Math.min(MAX_SAMPLES, profile.samples + weight),
    updatedAt: now,
  }
}

export function rank(candidates: readonly Candidate[], needs: TaskNeeds): Match[] {
  const required = CAPABILITIES.filter((capability) => needs.capabilities[capability] !== undefined)
  return candidates
    .map((candidate) => {
      const gaps = required.filter((capability) => {
        const expected = needs.capabilities[capability] ?? 0
        const actual = candidate.profile.capabilities[capability]
        return RISK_CAPABILITIES.has(capability) ? actual > expected : actual < expected
      })
      const distance = required.length === 0
        ? 0
        : average(required.map((capability) => {
            const expected = needs.capabilities[capability] ?? 0
            const actual = candidate.profile.capabilities[capability]
            return RISK_CAPABILITIES.has(capability) ? Math.max(0, actual - expected) : Math.max(0, expected - actual)
          }))
      return { candidate, score: Math.round((SCORE_MAX - distance) * 1000) / 1000, gaps }
    })
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id))
}

export function policy(profile: Profile): GuardPolicy {
  const planning = strength(profile.capabilities.planning)
  const review = strength(
    average([
      profile.capabilities.debugging,
      profile.capabilities.architectureJudgment,
      profile.capabilities.selfVerification,
    ]),
  )
  const completion = strength(
    average([
      profile.capabilities.instructionAdherence,
      profile.capabilities.longHorizonPersistence,
      profile.capabilities.selfVerification,
      safer(profile.capabilities.stopEarlyTendency),
    ]),
  )
  const context = strength(
    average([
      profile.capabilities.contextEfficiency,
      profile.capabilities.repositoryNavigation,
      safer(profile.capabilities.overexplorationTendency),
      safer(profile.capabilities.hallucinatedConfigurationTendency),
      safer(profile.capabilities.repeatedActionTendency),
    ]),
  )
  return { planning, review, completion, context }
}

export type Route = {
  readonly model: string
  readonly capabilities: CapabilityScores
  readonly tasks: readonly string[]
}

export const ROUTES: readonly Route[] = [
  {
    model: "cheap-fast",
    capabilities: { instructionAdherence: 0.8, planning: 0.3, repositoryNavigation: 0.9, toolUse: 0.7, longHorizonPersistence: 0.4, debugging: 0.3, contextEfficiency: 0.9, architectureJudgment: 0.3, selfVerification: 0.5, stopEarlyTendency: 0.2, overexplorationTendency: 0.1, hallucinatedConfigurationTendency: 0.1, repeatedActionTendency: 0.1 },
    tasks: ["repository-queries", "mechanical-edits", "boilerplate", "simple-review"],
  },
  {
    model: "primary-coding",
    capabilities: { instructionAdherence: 0.9, planning: 0.7, repositoryNavigation: 0.8, toolUse: 0.8, longHorizonPersistence: 0.7, debugging: 0.7, contextEfficiency: 0.7, architectureJudgment: 0.6, selfVerification: 0.7, stopEarlyTendency: 0.3, overexplorationTendency: 0.2, hallucinatedConfigurationTendency: 0.2, repeatedActionTendency: 0.2 },
    tasks: ["normal-implementation", "bug-fix", "feature"],
  },
  {
    model: "strong-reasoning",
    capabilities: { instructionAdherence: 0.95, planning: 0.9, repositoryNavigation: 0.8, toolUse: 0.8, longHorizonPersistence: 0.9, debugging: 0.9, contextEfficiency: 0.6, architectureJudgment: 0.9, selfVerification: 0.8, stopEarlyTendency: 0.1, overexplorationTendency: 0.1, hallucinatedConfigurationTendency: 0.1, repeatedActionTendency: 0.1 },
    tasks: ["difficult-debugging", "architecture", "high-risk-concurrency", "high-risk-security"],
  },
] as const

export function route(capabilities: CapabilityScores): Route {
  const planning = capabilities.planning
  const debugging = capabilities.debugging
  const architectureJudgment = capabilities.architectureJudgment

  if (planning >= 0.7 && debugging >= 0.7 && architectureJudgment >= 0.7) {
    return ROUTES[2]
  }
  if (planning >= 0.5 && debugging >= 0.5) {
    return ROUTES[1]
  }
  return ROUTES[0]
}

export * as Capabilities from "./capabilities"
