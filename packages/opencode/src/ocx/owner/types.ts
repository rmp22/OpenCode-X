export type DomainName = string

export type OwnerID = string

export type ConcreteScopeKind =
  | "DIRECTORY"
  | "FILE"
  | "FILE_PATTERN"
  | "FILE_GROUP"
  | "PACKAGE"
  | "MODULE"
  | "SYMBOL_GROUP"
  | "API_SURFACE"
  | "path_prefix"
  | "glob"
  | "module_root"
  | "subsystem"
  | "custom"

export type WorkspaceIdentity = {
  readonly workspaceRoot: string
  readonly repoId: string
  readonly name: string
}

export type OwnerTreeNode = {
  readonly id: OwnerID
  readonly name: string
  readonly relativePath: string
  readonly scopeKind: ConcreteScopeKind
  readonly patterns?: readonly string[]
  readonly parentId?: OwnerID
  readonly childrenIds: readonly OwnerID[]
  readonly reviewConcerns?: readonly string[]
  readonly noParent?: boolean
  readonly source: "aosp_owners" | "codeowners" | "virtual_discovery" | "user_config"
}

export type OwnerTree = {
  readonly workspace: WorkspaceIdentity
  readonly nodes: Readonly<Record<OwnerID, OwnerTreeNode>>
  readonly rootNodeId: OwnerID
  readonly version: number
  readonly updatedAt: number
}

export type OwnerScope = {
  readonly id: string
  readonly ownerId: OwnerID
  readonly kind: ConcreteScopeKind
  readonly pathPrefixes: readonly string[]
  readonly globs?: readonly string[]
  readonly moduleRoot?: string
  readonly anchorFiles?: readonly string[]
  readonly priority?: number
  readonly description?: string
  readonly reviewConcerns?: readonly string[]
}

export type ConcreteOwner = {
  readonly id: OwnerID
  readonly name: string
  readonly topic: string
  readonly kind: "module" | "directory" | "subsystem" | "feature" | "custom"
  readonly scopes: readonly OwnerScope[]
  readonly rootDir?: string
  readonly anchorFiles?: readonly string[]
  readonly dependencies?: readonly OwnerID[]
  readonly sourceRevision?: string
  readonly readiness: "uninitialized" | "ready" | "stale" | "refreshing" | "busy" | "failed"
  readonly modelTier: "primary" | "light"
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type ExecutionBudget = {
  readonly maxTurns: number
  readonly maxTokens: number
  readonly maxToolCalls?: number
  readonly wallClockMs?: number
  readonly remainingTurns?: number
  readonly remainingTokens?: number
}

export type HierarchicalBudget = {
  readonly rootBudget: {
    readonly maxTurns: number
    readonly maxTokens: number
    readonly maxToolCalls: number
    readonly wallClockMs: number
  }
  readonly ownerAllocated: {
    readonly maxTurns: number
    readonly maxTokens: number
    readonly maxToolCalls: number
    readonly wallClockMs: number
  }
  readonly consumed: {
    readonly turns: number
    readonly tokens: number
    readonly toolCalls: number
    readonly elapsedMs: number
  }
  readonly remainingTurns: number
  readonly remainingTokens: number
  readonly remainingToolCalls: number
  readonly remainingTimeMs: number
}

export type SourceObservation = {
  readonly path: string
  readonly contentHash: string
  readonly mtimeMs: number
  readonly snippet?: string
  readonly fullContent?: string
  readonly observedAt: number
  readonly observedBy: OwnerID | string
}

export type ExecutionPacket = {
  readonly taskId: string
  readonly ownerId: OwnerID
  readonly goal: string
  readonly scopePaths: readonly string[]
  readonly budget: HierarchicalBudget | ExecutionBudget
  readonly sourceObservations?: readonly SourceObservation[]
  readonly workGraphNodeId?: string
  readonly parentSessionId?: string
  readonly callerOwnerId?: OwnerID
  readonly context?: Readonly<Record<string, unknown>>
  readonly createdAt: number
}

export type OwnerCheckpoint = {
  readonly checkpointId: string
  readonly taskId: string
  readonly ownerId: OwnerID
  readonly step: number
  readonly state: "in_progress" | "yielded" | "completed" | "failed"
  readonly summary: string
  readonly evidence: readonly string[]
  readonly completed: boolean
  readonly touchedFiles: readonly string[]
  readonly nextAction?: string
  readonly timestamp: number
}

export type ExecutionResultStatus = "completed" | "failed" | "blocked" | "yielded"

export type OwnerHandoff = {
  readonly fromOwnerId: OwnerID
  readonly toOwnerId: OwnerID
  readonly taskId: string
  readonly reason: string
  readonly sharedScope: readonly string[]
  readonly suggestedAction: string
  readonly contextPayload?: Readonly<Record<string, unknown>>
}

export type ExecutionResult = {
  readonly taskId: string
  readonly ownerId: OwnerID
  readonly status: ExecutionResultStatus
  readonly summary: string
  readonly touchedFiles: readonly string[]
  readonly producedArtifacts: readonly string[]
  readonly consumedBudget: {
    readonly turns: number
    readonly tokens: number
    readonly toolCalls: number
    readonly elapsedMs: number
  }
  readonly checkpoint?: OwnerCheckpoint
  readonly handoff?: OwnerHandoff
  readonly error?: string
  readonly completedAt: number
}

export type OwnerPathLease = {
  readonly leaseId: string
  readonly pathPrefix: string
  readonly ownerId: OwnerID
  readonly sessionID: string
  readonly acquiredAt: number
  readonly expiresAt: number
}

export type DomainLease = {
  readonly domain: DomainName
  readonly sessionID: string
  readonly acquiredAt: number
  readonly expiresAt: number
}

export type DomainFact = {
  readonly domain: DomainName
  readonly category: string
  readonly key: string
  readonly value: string
  readonly updatedAt: number
  readonly isTransient?: boolean
}

export type LeaseResult =
  | { readonly success: true; readonly lease: DomainLease }
  | { readonly success: false; readonly reason: string; readonly currentLease?: DomainLease }

export type PathLeaseResult =
  | { readonly success: true; readonly lease: OwnerPathLease }
  | { readonly success: false; readonly reason: string; readonly currentLease?: OwnerPathLease }

export type OwnerCapabilityBoundary = {
  readonly ownerId: string
  readonly allowedDomains: readonly string[]
  readonly deniedTools?: readonly string[]
  readonly maxTokensBudget?: number
}

export type HITLRiskLevel = "low" | "medium" | "high" | "critical"

export type HITLApprovalRequest = {
  readonly id: string
  readonly proposedAction: string
  readonly riskAssessment: HITLRiskLevel
  readonly blastRadius: readonly string[]
  readonly alternativesConsidered: readonly string[]
  readonly rollbackPlan: string
  readonly timestamp: number
}

export type HITLResolution =
  | { readonly status: "approved"; readonly action: string }
  | { readonly status: "rejected"; readonly alternativePath: string; readonly feedback?: string }

export * as OwnerStateTypes from "./types"
