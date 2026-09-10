export const STATUSES = ["captured", "integrated", "conflict", "failed", "discarded"] as const
export type Status = (typeof STATUSES)[number]

export type Record = {
  readonly id: string
  readonly repositoryID: string
  readonly taskID: string
  readonly ownerID: string
  readonly primarySessionID: string
  readonly baseRevision: string
  readonly worktree: string
  readonly patch: string
  readonly changedPaths: readonly string[]
  readonly affectedSymbols: readonly string[]
  readonly assumptions: readonly string[]
  readonly dependencies: readonly string[]
  readonly invariantsChecked: readonly string[]
  readonly testsRun: readonly string[]
  readonly unverifiedItems: readonly string[]
  readonly integrationNotes: readonly string[]
  readonly status: Status
  readonly resultingRevision?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type Evidence = Pick<
  Record,
  "affectedSymbols" | "assumptions" | "dependencies" | "invariantsChecked" | "testsRun" | "unverifiedItems"
>

export type IntegrationDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] }

const MAX_TEXT = 400
const MAX_ID = 160
const MAX_PATCH = 2_000_000
const MAX_LIST = 64

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const result = value.trim()
  return result.length > 0 && result.length <= max && !result.includes("===") ? result : undefined
}

function patch(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_PATCH ? value : undefined
}

function list(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST) return undefined
  return value.flatMap((item) => {
    const result = text(item)
    return result ? [result] : []
  })
}

function status(value: unknown): Status | undefined {
  return typeof value === "string" && STATUSES.includes(value as Status) ? (value as Status) : undefined
}

function time(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function parse(value: unknown): Record | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as globalThis.Record<string, unknown>
  const id = text(input.id, MAX_ID)
  const repositoryID = text(input.repositoryID, MAX_ID)
  const taskID = text(input.taskID, MAX_ID)
  const ownerID = text(input.ownerID, MAX_ID)
  const primarySessionID = text(input.primarySessionID, MAX_ID)
  const baseRevision = text(input.baseRevision, MAX_ID)
  const worktree = text(input.worktree, MAX_PATCH)
  const changePatch = patch(input.patch)
  const changedPaths = list(input.changedPaths)
  const affectedSymbols = list(input.affectedSymbols)
  const assumptions = list(input.assumptions)
  const dependencies = list(input.dependencies)
  const invariantsChecked = list(input.invariantsChecked)
  const testsRun = list(input.testsRun)
  const unverifiedItems = list(input.unverifiedItems)
  const integrationNotes = list(input.integrationNotes)
  const changeStatus = status(input.status)
  const resultingRevision = input.resultingRevision === undefined ? undefined : text(input.resultingRevision, MAX_ID)
  const createdAt = time(input.createdAt)
  const updatedAt = time(input.updatedAt)
  if (
    !id ||
    !repositoryID ||
    !taskID ||
    !ownerID ||
    !primarySessionID ||
    !baseRevision ||
    !worktree ||
    changePatch === undefined ||
    !changedPaths ||
    !affectedSymbols ||
    !assumptions ||
    !dependencies ||
    !invariantsChecked ||
    !testsRun ||
    !unverifiedItems ||
    !integrationNotes ||
    !changeStatus ||
    createdAt === undefined ||
    updatedAt === undefined
  )
    return undefined
  return {
    id,
    repositoryID,
    taskID,
    ownerID,
    primarySessionID,
    baseRevision,
    worktree,
    patch: changePatch,
    changedPaths,
    affectedSymbols,
    assumptions,
    dependencies,
    invariantsChecked,
    testsRun,
    unverifiedItems,
    integrationNotes,
    status: changeStatus,
    ...(resultingRevision ? { resultingRevision } : {}),
    createdAt,
    updatedAt,
  }
}

function pathOverlap(left: string, right: string): boolean {
  const a = left.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
  const b = right.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function overlaps(left: Record, right: Record): string[] {
  return [...new Set(left.changedPaths.flatMap((leftPath) => right.changedPaths.filter((rightPath) => pathOverlap(leftPath, rightPath))))]
}

export function canIntegrate(input: {
  readonly records: readonly Record[]
  readonly currentRevision: string
  readonly primaryClean: boolean
}): IntegrationDecision {
  const reasons: string[] = []
  if (!input.primaryClean) reasons.push("primary repository has local changes")
  for (const record of input.records) {
    if (record.status !== "captured") reasons.push(`${record.id} is not ready: ${record.status}`)
    if (record.baseRevision !== input.currentRevision)
      reasons.push(`${record.id} is based on ${record.baseRevision}, current revision is ${input.currentRevision}`)
    if (!record.patch) reasons.push(`${record.id} contains no patch`)
  }
  for (let index = 0; index < input.records.length; index++) {
    const left = input.records[index]
    if (!left) continue
    for (const right of input.records.slice(index + 1)) {
      const paths = overlaps(left, right)
      if (paths.length > 0) reasons.push(`${left.id} overlaps ${right.id}: ${paths.join(", ")}`)
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

export * as Changeset from "./changeset"
