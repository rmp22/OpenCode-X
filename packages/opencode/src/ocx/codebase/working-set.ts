import path from "node:path"
import type { CallerEvidence, SearchCandidate, WorkingSet, WorkingSetItem } from "./types"

export type Limits = {
  readonly maxModules: number
  readonly maxDirectories: number
  readonly maxFiles: number
  readonly maxSymbols: number
  readonly maxTests: number
  readonly maxBuildFiles: number
  readonly maxConfigurationFiles: number
}

export type WorkingSetKind =
  | "modules"
  | "directories"
  | "files"
  | "symbols"
  | "tests"
  | "buildFiles"
  | "configurationFiles"

export type Evidence = {
  readonly kind: WorkingSetKind
  readonly path: string
  readonly confidence: number
  readonly reason: string
  readonly now?: number
}

const DEFAULT_LIMITS: Limits = {
  maxModules: 32,
  maxDirectories: 128,
  maxFiles: 256,
  maxSymbols: 128,
  maxTests: 128,
  maxBuildFiles: 64,
  maxConfigurationFiles: 64,
}

export function create(taskID: string, now = Date.now()): WorkingSet {
  const set: WorkingSet = {
    taskID,
    modules: [],
    directories: [],
    files: [],
    symbols: [],
    tests: [],
    buildFiles: [],
    configurationFiles: [],
    callerEvidence: [],
    updatedAt: now,
  }
  return set
}

export function add(set: WorkingSet, evidence: Evidence, limits: Partial<Limits> = {}): WorkingSet {
  const item: WorkingSetItem = {
    path: normalize(evidence.path),
    confidence: clamp(evidence.confidence),
    reason: evidence.reason.trim().slice(0, 240),
    addedAt: evidence.now ?? Date.now(),
  }
  if (!item.path || !item.reason) return set
  const key = evidence.kind
  const current = set[key]
  const existing = current.find((candidate) => candidate.path === item.path)
  const next = existing
    ? current.map((candidate) =>
        candidate.path === item.path ? (candidate.confidence >= item.confidence ? candidate : item) : candidate,
      )
    : [...current, item]
  const bounded = next
    .toSorted((a, b) => b.confidence - a.confidence || b.addedAt - a.addedAt || a.path.localeCompare(b.path))
    .slice(0, limitFor(key, limits))
  return { ...set, [key]: bounded, updatedAt: item.addedAt }
}

export function update(set: WorkingSet, evidence: readonly Evidence[], limits: Partial<Limits> = {}): WorkingSet {
  return evidence.reduce((current, item) => add(current, item, limits), set)
}

export function updateFromPaths(
  set: WorkingSet,
  input: {
    readonly modules?: readonly string[]
    readonly directories?: readonly string[]
    readonly files?: readonly string[]
    readonly tests?: readonly string[]
    readonly buildFiles?: readonly string[]
    readonly configurationFiles?: readonly string[]
    readonly reason: string
    readonly confidence?: number
    readonly now?: number
  },
  limits: Partial<Limits> = {},
): WorkingSet {
  const confidence = input.confidence ?? 0.75
  const kinds = [
    ["modules", input.modules],
    ["directories", input.directories],
    ["files", input.files],
    ["tests", input.tests],
    ["buildFiles", input.buildFiles],
    ["configurationFiles", input.configurationFiles],
  ] as const
  return update(
    set,
    kinds.flatMap(([kind, values]) =>
      (values ?? []).map((value) => ({ kind, path: value, confidence, reason: input.reason, now: input.now })),
    ),
    limits,
  )
}

export function rankCandidates(set: WorkingSet, candidates: readonly SearchCandidate[]): SearchCandidate[] {
  const proximity = new Map(set.directories.concat(set.modules, set.files).map((item) => [item.path, item.confidence]))
  return candidates.toSorted((a, b) => score(b) - score(a) || a.scope.localeCompare(b.scope))

  function score(candidate: SearchCandidate): number {
    const confidence = [...proximity.entries()].reduce(
      (best, [item, value]) =>
        candidate.scope === item || candidate.scope.startsWith(`${item}/`) || candidate.scope.endsWith(`/${item}`)
          ? Math.max(best, value)
          : best,
      0,
    )
    return candidate.relevance + confidence * 2 - candidate.estimatedCost / 100
  }
}

export function reset(taskID: string, now = Date.now()): WorkingSet {
  return create(taskID, now)
}

export function render(set: WorkingSet, maxItems = 12): string[] {
  return [
    ...set.modules.slice(0, maxItems).map((item) => `module:${item.path}`),
    ...set.directories.slice(0, maxItems).map((item) => `directory:${item.path}`),
    ...set.files.slice(0, maxItems).map((item) => `file:${item.path}`),
  ]
}

function limitFor(kind: Evidence["kind"], limits: Partial<Limits>): number {
  const selected = {
    modules: limits.maxModules,
    directories: limits.maxDirectories,
    files: limits.maxFiles,
    symbols: limits.maxSymbols,
    tests: limits.maxTests,
    buildFiles: limits.maxBuildFiles,
    configurationFiles: limits.maxConfigurationFiles,
  }[kind]
  const fallback = {
    modules: DEFAULT_LIMITS.maxModules,
    directories: DEFAULT_LIMITS.maxDirectories,
    files: DEFAULT_LIMITS.maxFiles,
    symbols: DEFAULT_LIMITS.maxSymbols,
    tests: DEFAULT_LIMITS.maxTests,
    buildFiles: DEFAULT_LIMITS.maxBuildFiles,
    configurationFiles: DEFAULT_LIMITS.maxConfigurationFiles,
  }[kind]
  return Number.isInteger(selected) && selected !== undefined && selected > 0 ? selected : fallback
}

function normalize(value: string): string {
  const cleaned = value.trim().replaceAll("\\", "/")
  if (!cleaned) return ""
  return path.posix.normalize(cleaned).replace(/^\.\//, "")
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function recordCallerEvidence(
  set: WorkingSet,
  evidence: CallerEvidence | readonly CallerEvidence[],
): WorkingSet {
  const current = set.callerEvidence ?? []
  const incoming = Array.isArray(evidence) ? evidence : [evidence]
  const updated = [...current]
  for (const item of incoming) {
    const existingIdx = updated.findIndex(
      (e) => e.symbol === item.symbol && e.callerFile === item.callerFile && e.line === item.line,
    )
    if (existingIdx >= 0) {
      updated[existingIdx] = item
    } else {
      updated.push(item)
    }
  }
  const res: WorkingSet = {
    ...set,
    callerEvidence: updated,
    updatedAt: Date.now(),
  }
  return res
}

export function verifyCaller(
  set: WorkingSet,
  callerFile: string,
  line?: number,
  note?: string,
): WorkingSet {
  const current = set.callerEvidence ?? []
  const updated = current.map((item) => {
    if (item.callerFile === callerFile && (line === undefined || item.line === line)) {
      const verifiedItem: CallerEvidence = {
        ...item,
        verified: true,
        verificationNote: note ?? item.verificationNote,
      }
      return verifiedItem
    }
    return item
  })
  const res: WorkingSet = {
    ...set,
    callerEvidence: updated,
    updatedAt: Date.now(),
  }
  return res
}

export function isAllCallersVerified(set: WorkingSet, symbol?: string): boolean {
  const current = set.callerEvidence ?? []
  if (current.length === 0) return true
  const relevant = symbol ? current.filter((item) => item.symbol === symbol) : current
  if (relevant.length === 0) return true
  const allVerified = relevant.every((item) => item.verified)
  return allVerified
}

export function clearVerifiedCallers(set: WorkingSet): WorkingSet {
  const current = set.callerEvidence ?? []
  const remaining = current.filter((item) => !item.verified)
  const res: WorkingSet = {
    ...set,
    callerEvidence: remaining,
    updatedAt: Date.now(),
  }
  return res
}

export function compactWorkingSet(set: WorkingSet): WorkingSet {
  const unverified = (set.callerEvidence ?? []).filter((item) => !item.verified)
  const res: WorkingSet = {
    ...set,
    callerEvidence: unverified,
    updatedAt: Date.now(),
  }
  return res
}

export * as CodebaseWorkingSet from "./working-set"
