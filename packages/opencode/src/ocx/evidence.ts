import type { CheckKind } from "./ledger"
import { Provenance } from "./provenance"

export type Outcome = "passed" | "failed" | "skipped" | "unknown"

export type Verification = {
  readonly id: string
  readonly sessionID: string
  readonly repositoryID: string
  readonly check: CheckKind
  readonly command?: string
  readonly cwd?: string
  readonly outcome: Outcome
  readonly durationMs?: number
  readonly revision?: string
  readonly policyVersion?: string
  readonly ownerIDs: readonly string[]
  readonly taskID?: string
  readonly createdAt: number
}

export type LinkRecord = {
  readonly id: string
  readonly source: Provenance.Source
  readonly sourceRef?: string
  readonly target: string
  readonly relation: Provenance.Link["relation"]
  readonly createdAt: number
}

const MAX_TEXT = 400
const MAX_ID = 160
const MAX_LIST = 16

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.trim()
  return result.length > 0 && result.length <= max && !result.includes("===") ? result : undefined
}

function list(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST) return undefined
  return value.flatMap((item) => {
    const result = text(item, MAX_ID)
    return result ? [result] : []
  })
}

function check(value: unknown): CheckKind | undefined {
  return value === "lint" || value === "typecheck" || value === "test" || value === "build" ? value : undefined
}

function outcome(value: unknown): Outcome | undefined {
  return value === "passed" || value === "failed" || value === "skipped" || value === "unknown" ? value : undefined
}

function time(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function parseVerification(value: unknown): Verification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as globalThis.Record<string, unknown>
  const id = text(input.id, MAX_ID)
  const sessionID = text(input.sessionID, MAX_ID)
  const repositoryID = text(input.repositoryID, MAX_ID)
  const checkValue = check(input.check)
  const command = input.command === undefined ? undefined : text(input.command)
  const cwd = input.cwd === undefined ? undefined : text(input.cwd, MAX_ID)
  const outcomeValue = outcome(input.outcome)
  const durationMs = input.durationMs === undefined ? undefined : time(input.durationMs)
  const revision = input.revision === undefined ? undefined : text(input.revision, MAX_ID)
  const policyVersion = input.policyVersion === undefined ? undefined : text(input.policyVersion, MAX_ID)
  const ownerIDs = list(input.ownerIDs)
  const taskID = input.taskID === undefined ? undefined : text(input.taskID, MAX_ID)
  const createdAt = time(input.createdAt)
  if (
    !id ||
    !sessionID ||
    !repositoryID ||
    !checkValue ||
    !outcomeValue ||
    !ownerIDs ||
    createdAt === undefined ||
    (input.command !== undefined && !command) ||
    (input.cwd !== undefined && !cwd) ||
    (input.durationMs !== undefined && durationMs === undefined) ||
    (input.revision !== undefined && !revision) ||
    (input.policyVersion !== undefined && !policyVersion) ||
    (input.taskID !== undefined && !taskID)
  )
    return undefined
  return {
    id,
    sessionID,
    repositoryID,
    check: checkValue,
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    outcome: outcomeValue,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(revision ? { revision } : {}),
    ...(policyVersion ? { policyVersion } : {}),
    ownerIDs,
    ...(taskID ? { taskID } : {}),
    createdAt,
  }
}

export function parseLink(value: unknown): LinkRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as globalThis.Record<string, unknown>
  const id = text(input.id, MAX_ID)
  const source = Provenance.parseSource(input.source)
  const sourceRef = input.sourceRef === undefined ? undefined : Provenance.reference(input.sourceRef)
  const target = text(input.target, MAX_ID)
  const relation = input.relation
  const createdAt = time(input.createdAt)
  if (
    !id ||
    !source ||
    !target ||
    (input.sourceRef !== undefined && !sourceRef) ||
    (relation !== "supports" && relation !== "caused" && relation !== "verifiedBy" && relation !== "supersedes" && relation !== "affects") ||
    createdAt === undefined
  )
    return undefined
  return { id, source, ...(sourceRef ? { sourceRef } : {}), target, relation, createdAt }
}

export * as Evidence from "./evidence"
export * from "./evidence/types"
export * from "./evidence/collector"
export * from "./evidence/verifier"
export * from "./evidence/store"
export * from "./evidence/acceptance"
