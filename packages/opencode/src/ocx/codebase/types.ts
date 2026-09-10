export const SCALE_VALUES = ["SMALL", "MEDIUM", "LARGE", "MASSIVE"] as const
export type Scale = (typeof SCALE_VALUES)[number]
export type ScaleKey = Lowercase<Scale>

export const PATH_CLASS_VALUES = [
  "SOURCE",
  "TEST",
  "GENERATED",
  "BUILD_OUTPUT",
  "DEPENDENCY",
  "VENDOR",
  "PREBUILT",
  "CACHE",
  "VCS_METADATA",
  "DOCUMENTATION",
  "TOOLS",
  "UNKNOWN",
] as const
export type PathClass = (typeof PATH_CLASS_VALUES)[number]

export const INTENT_VALUES = [
  "FILE",
  "PATH",
  "SYMBOL",
  "DEFINITION",
  "REFERENCE",
  "IMPLEMENTATION",
  "TEXT",
  "CONFIG",
  "BUILD_TARGET",
  "DEPENDENCY",
  "TEST",
  "OWNERSHIP",
  "HISTORY",
  "UNKNOWN",
] as const
export type SearchIntent = (typeof INTENT_VALUES)[number]

export const SEARCH_FAMILY_VALUES = [
  "recursive_text_search",
  "recursive_path_scan",
  "path_index",
  "symbol_index",
] as const
export type SearchFamily = (typeof SEARCH_FAMILY_VALUES)[number]

export type ScaleThresholds = {
  readonly smallMaxFiles: number
  readonly mediumMaxFiles: number
  readonly largeMaxFiles: number
}

export type SearchBudget = {
  readonly softTimeoutMs: number
  readonly hardTimeoutMs: number
  readonly maxOutputLines: number
  readonly maxOutputBytes: number
  readonly maxResults: number
}

export type CodebaseConfig = {
  readonly enabled: boolean
  readonly blockMassiveRootRecursiveSearch: boolean
  readonly rewriteBroadSearches: boolean
  readonly killProcessTreeOnTimeout: boolean
  readonly scaleThresholds: ScaleThresholds
  readonly budgets: Record<ScaleKey, SearchBudget>
  readonly maxWorkingSetModules: number
  readonly maxWorkingSetDirectories: number
  readonly maxHistoryEntries: number
  readonly maxProfileSamplePaths: number
  readonly maxProfileOutputBytes: number
}

const BUDGETS: Record<ScaleKey, SearchBudget> = {
  small: {
    softTimeoutMs: 10_000,
    hardTimeoutMs: 30_000,
    maxOutputLines: 5_000,
    maxOutputBytes: 512_000,
    maxResults: 1_000,
  },
  medium: {
    softTimeoutMs: 5_000,
    hardTimeoutMs: 15_000,
    maxOutputLines: 2_000,
    maxOutputBytes: 256_000,
    maxResults: 500,
  },
  large: {
    softTimeoutMs: 3_000,
    hardTimeoutMs: 10_000,
    maxOutputLines: 1_000,
    maxOutputBytes: 128_000,
    maxResults: 250,
  },
  massive: {
    softTimeoutMs: 2_000,
    hardTimeoutMs: 8_000,
    maxOutputLines: 500,
    maxOutputBytes: 64_000,
    maxResults: 100,
  },
}

export const DEFAULT_CODEBASE_CONFIG: CodebaseConfig = {
  enabled: true,
  blockMassiveRootRecursiveSearch: true,
  rewriteBroadSearches: true,
  killProcessTreeOnTimeout: true,
  scaleThresholds: {
    smallMaxFiles: 5_000,
    mediumMaxFiles: 50_000,
    largeMaxFiles: 250_000,
  },
  budgets: BUDGETS,
  maxWorkingSetModules: 32,
  maxWorkingSetDirectories: 128,
  maxHistoryEntries: 256,
  maxProfileSamplePaths: 4_096,
  maxProfileOutputBytes: 8 * 1024 * 1024,
}

export type RepositoryProfile = {
  readonly version: 1
  readonly root: string
  readonly scale: Scale
  readonly estimatedFileCount: number
  readonly estimatedDirectoryCount: number
  readonly trackedFileCount?: number
  readonly estimatedBytes?: number
  readonly languages: readonly string[]
  readonly fileTypes: Readonly<Record<string, number>>
  readonly buildSystems: readonly string[]
  readonly repoTypes: readonly string[]
  readonly sourceRoots: readonly string[]
  readonly generatedRoots: readonly string[]
  readonly dependencyRoots: readonly string[]
  readonly buildFiles: readonly string[]
  readonly samplePaths: readonly string[]
  readonly rootEntries: readonly string[]
  readonly rootMarkerSignature: string
  readonly topologySignature: string
  readonly sourceRevision?: string
  readonly profileTimestamp: number
  readonly confidence: "high" | "medium" | "low"
}

export type ModuleRecord = {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly type: string
  readonly parentModuleID?: string
  readonly buildSystem?: string
  readonly buildFile?: string
  readonly sourceRoots: readonly string[]
  readonly testRoots: readonly string[]
  readonly generatedRoots: readonly string[]
  readonly dependencyRoots: readonly string[]
}

export type RepositoryMap = {
  readonly version: 1
  readonly root: string
  readonly modules: readonly ModuleRecord[]
  readonly buildFiles: readonly string[]
  readonly sourceRoots: readonly string[]
  readonly testRoots: readonly string[]
  readonly generatedRoots: readonly string[]
  readonly dependencyRoots: readonly string[]
  readonly fingerprints: readonly string[]
  readonly updatedAt: number
}

export type FileRecord = {
  readonly root: string
  readonly path: string
  readonly basename: string
  readonly extension: string
  readonly language?: string
  readonly size: number
  readonly modifiedTime: number
  readonly moduleID?: string
  readonly rootType: PathClass
  readonly isGenerated: boolean
  readonly isDependency: boolean
  readonly isTest: boolean
  readonly isTracked: boolean
}

export type WorkingSetItem = {
  readonly path: string
  readonly confidence: number
  readonly reason: string
  readonly addedAt: number
}

export type CallerEvidence = {
  readonly symbol: string
  readonly callerFile: string
  readonly line: number
  readonly verified: boolean
  readonly verificationNote?: string
}

export type WorkingSet = {
  readonly taskID: string
  readonly modules: readonly WorkingSetItem[]
  readonly directories: readonly WorkingSetItem[]
  readonly files: readonly WorkingSetItem[]
  readonly symbols: readonly WorkingSetItem[]
  readonly tests: readonly WorkingSetItem[]
  readonly buildFiles: readonly WorkingSetItem[]
  readonly configurationFiles: readonly WorkingSetItem[]
  readonly callerEvidence?: readonly CallerEvidence[]
  readonly updatedAt: number
}

export type SearchRequest = {
  readonly query: string
  readonly intent?: SearchIntent | readonly SearchIntent[]
  readonly currentFile?: string
  readonly requestedScope?: string
  readonly include?: string
  readonly sessionID?: string
  readonly explicitRepositoryWide?: boolean
}

export type SearchCandidate = {
  readonly scope: string
  readonly level: 0 | 1 | 2 | 3 | 4 | 5
  readonly relevance: number
  readonly estimatedCost: number
  readonly pathClass: PathClass
  readonly reason: string
  readonly recursive: boolean
}

export type SearchPlan = {
  readonly intent: readonly SearchIntent[]
  readonly candidates: readonly SearchCandidate[]
  readonly selected: SearchCandidate
  readonly likelyRoots: readonly string[]
  readonly excludedByDefault: readonly string[]
}

export type SearchRoute = {
  readonly family: SearchFamily
  readonly scope: string
  readonly recursive: boolean
  readonly intent: readonly SearchIntent[]
  readonly include?: string
  readonly explicitRepositoryWide: boolean
}

export type GuardAction = "ALLOW" | "ALLOW_WITH_BUDGET" | "REWRITE" | "BLOCK"

export type SearchGuardDecision = {
  readonly action: GuardAction
  readonly budget: SearchBudget
  readonly reason?: string
  readonly rewrittenScope?: string
  readonly recommendedScopes: readonly string[]
  readonly route: SearchRoute
}

export const SEARCH_FAILURE_REASON_VALUES = [
  "hard_timeout",
  "soft_timeout",
  "file_budget_exceeded",
  "output_budget_exceeded",
  "user_cancelled_due_to_cost",
  "process_error",
  "blocked",
] as const
export type SearchFailureReason = (typeof SEARCH_FAILURE_REASON_VALUES)[number]

export type SearchRecord = {
  readonly id: string
  readonly normalizedQuery: string
  readonly intent: readonly SearchIntent[]
  readonly normalizedScope: string
  readonly searchFamily: SearchFamily
  readonly command?: string
  readonly repositoryRevision?: string
  readonly startTime: number
  readonly durationMs: number
  readonly exitStatus?: number
  readonly timeout: boolean
  readonly outputCount: number
  readonly resultQuality: "useful" | "empty" | "ambiguous" | "failed"
  readonly failureReason?: SearchFailureReason
}

export type SearchStat = {
  readonly family: SearchFamily
  readonly scope: string
  readonly count: number
  readonly useful: number
  readonly failures: number
  readonly totalDurationMs: number
  readonly lastDurationMs: number
}
