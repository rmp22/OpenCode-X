import { createHash } from "node:crypto"
import path from "node:path"
import {
  INTENT_VALUES,
  SEARCH_FAILURE_REASON_VALUES,
  SEARCH_FAMILY_VALUES,
  type SearchFamily,
  type SearchIntent,
  type SearchRecord,
  type SearchStat,
} from "./types"

export type SearchKeyInput = {
  readonly query: string
  readonly scope: string
  readonly family: SearchFamily
}

export type History = {
  readonly records: readonly SearchRecord[]
  readonly stats: readonly SearchStat[]
}

const RETRYABLE_FAILURES = new Set<SearchRecord["failureReason"]>([
  "hard_timeout",
  "soft_timeout",
  "file_budget_exceeded",
  "output_budget_exceeded",
  "user_cancelled_due_to_cost",
])

export function normalizeSearch(input: SearchKeyInput): SearchKeyInput {
  return {
    query: input.query.trim().replace(/\s+/g, " ").toLocaleLowerCase(),
    scope: normalizeScope(input.scope),
    family: input.family,
  }
}

export function familyForCommand(command: string): SearchFamily | undefined {
  const value = command.trim().toLocaleLowerCase()
  if (/\brg\b|\bgrep\b|\begrep\b|\bfgrep\b/.test(value)) return "recursive_text_search"
  if (/\bfind\b|\bfd\b/.test(value) || /\*\*?[/\\]/.test(value)) return "recursive_path_scan"
  return undefined
}

export function familyForTool(tool: "grep" | "glob"): SearchFamily {
  return tool === "grep" ? "recursive_text_search" : "recursive_path_scan"
}

export function record(input: {
  readonly query: string
  readonly intent: readonly SearchIntent[]
  readonly scope: string
  readonly family: SearchFamily
  readonly command?: string
  readonly repositoryRevision?: string
  readonly startTime: number
  readonly durationMs: number
  readonly exitStatus?: number
  readonly timeout?: boolean
  readonly outputCount: number
  readonly resultQuality: SearchRecord["resultQuality"]
  readonly failureReason?: SearchRecord["failureReason"]
}): SearchRecord {
  const key = normalizeSearch({ query: input.query, scope: input.scope, family: input.family })
  const digest = createHash("sha256")
    .update(`${key.query}\0${key.scope}\0${key.family}\0${input.startTime}`)
    .digest("hex")
    .slice(0, 24)
  return {
    id: `search_${digest}`,
    normalizedQuery: key.query,
    intent: [...input.intent],
    normalizedScope: key.scope,
    searchFamily: key.family,
    ...(input.command ? { command: input.command } : {}),
    ...(input.repositoryRevision ? { repositoryRevision: input.repositoryRevision } : {}),
    startTime: input.startTime,
    durationMs: Math.max(0, input.durationMs),
    ...(input.exitStatus === undefined ? {} : { exitStatus: input.exitStatus }),
    timeout: input.timeout === true,
    outputCount: Math.max(0, input.outputCount),
    resultQuality: input.resultQuality,
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
  }
}

export function append(history: History, next: SearchRecord, maxEntries = 256): History {
  const records = [...history.records, next].slice(-safeLimit(maxEntries))
  const key = { query: next.normalizedQuery, scope: next.normalizedScope, family: next.searchFamily }
  const previous = history.stats.find((item) => item.family === key.family && item.scope === key.scope)
  const stat: SearchStat = previous
    ? {
        ...previous,
        count: previous.count + 1,
        useful: previous.useful + (next.resultQuality === "useful" ? 1 : 0),
        failures: previous.failures + (next.resultQuality === "failed" ? 1 : 0),
        totalDurationMs: previous.totalDurationMs + next.durationMs,
        lastDurationMs: next.durationMs,
      }
    : {
        family: key.family,
        scope: key.scope,
        count: 1,
        useful: next.resultQuality === "useful" ? 1 : 0,
        failures: next.resultQuality === "failed" ? 1 : 0,
        totalDurationMs: next.durationMs,
        lastDurationMs: next.durationMs,
      }
  const stats = [...history.stats.filter((item) => item !== previous), stat]
    .toSorted((a, b) => b.count - a.count || a.family.localeCompare(b.family) || a.scope.localeCompare(b.scope))
    .slice(0, safeLimit(maxEntries))
  return { records, stats }
}

export function equivalentFailure(
  records: readonly SearchRecord[],
  input: SearchKeyInput & { readonly repositoryRevision?: string },
): SearchRecord | undefined {
  const key = normalizeSearch(input)
  return records.findLast((item) => {
    if (item.normalizedQuery !== key.query || item.normalizedScope !== key.scope || item.searchFamily !== key.family)
      return false
    if (!RETRYABLE_FAILURES.has(item.failureReason)) return false
    return compatibleRevision(item.repositoryRevision, input.repositoryRevision)
  })
}

export function parseLines(value: string, maxEntries = 256): SearchRecord[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.trim()) return []
      try {
        const parsed = JSON.parse(line) as unknown
        return isRecord(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
    .flatMap((item) => parseRecord(item))
    .slice(-safeLimit(maxEntries))
}

export function serialize(records: readonly SearchRecord[]): string {
  return records.map((item) => JSON.stringify(item)).join("\n") + (records.length > 0 ? "\n" : "")
}

export function parseStats(value: string, maxEntries = 256): SearchStat[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.trim()) return []
      try {
        const parsed = JSON.parse(line) as unknown
        return isRecord(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
    .flatMap((item) => parseStat(item))
    .slice(-safeLimit(maxEntries))
}

export function serializeStats(stats: readonly SearchStat[]): string {
  return stats.map((item) => JSON.stringify(item)).join("\n") + (stats.length > 0 ? "\n" : "")
}

function normalizeScope(value: string): string {
  const cleaned = value.trim().replaceAll("\\", "/")
  if (!cleaned || cleaned === "." || cleaned === "/") return "repo_root"
  return path.posix.normalize(cleaned).replace(/^\.\//, "")
}

function compatibleRevision(previous: string | undefined, current: string | undefined): boolean {
  if (!previous || !current) return true
  return previous === current
}

function parseRecord(value: Record<string, unknown>): SearchRecord[] {
  if (
    typeof value.id !== "string" ||
    typeof value.normalizedQuery !== "string" ||
    !Array.isArray(value.intent) ||
    !value.intent.every((item) => typeof item === "string" && INTENT_VALUES.includes(item as SearchIntent)) ||
    typeof value.normalizedScope !== "string" ||
    !SEARCH_FAMILY_VALUES.includes(value.searchFamily as SearchFamily) ||
    typeof value.startTime !== "number" ||
    typeof value.durationMs !== "number" ||
    typeof value.timeout !== "boolean" ||
    typeof value.outputCount !== "number" ||
    (value.command !== undefined && typeof value.command !== "string") ||
    (value.repositoryRevision !== undefined && typeof value.repositoryRevision !== "string") ||
    (value.exitStatus !== undefined && typeof value.exitStatus !== "number") ||
    (value.failureReason !== undefined &&
      !SEARCH_FAILURE_REASON_VALUES.includes(value.failureReason as (typeof SEARCH_FAILURE_REASON_VALUES)[number])) ||
    (value.resultQuality !== "useful" &&
      value.resultQuality !== "empty" &&
      value.resultQuality !== "ambiguous" &&
      value.resultQuality !== "failed")
  )
    return []
  return [value as unknown as SearchRecord]
}

function parseStat(value: Record<string, unknown>): SearchStat[] {
  if (
    !SEARCH_FAMILY_VALUES.includes(value.family as SearchFamily) ||
    typeof value.scope !== "string" ||
    typeof value.count !== "number" ||
    typeof value.useful !== "number" ||
    typeof value.failures !== "number" ||
    typeof value.totalDurationMs !== "number" ||
    typeof value.lastDurationMs !== "number" ||
    !Number.isFinite(value.count) ||
    !Number.isFinite(value.useful) ||
    !Number.isFinite(value.failures) ||
    !Number.isFinite(value.totalDurationMs) ||
    !Number.isFinite(value.lastDurationMs)
  )
    return []
  return [value as unknown as SearchStat]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 10_000) : 256
}

export * as CodebaseHistory from "./history"
