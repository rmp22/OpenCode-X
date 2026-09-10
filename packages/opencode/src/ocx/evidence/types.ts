export type EvidenceKind =
  | "test_run"
  | "typecheck"
  | "diff_inspection"
  | "build_output"
  | "lint_check"
  | "read_artifact"
  | "runtime_log"

export type EvidenceSourceKind = "command" | "file" | "test" | "typecheck" | "diff"

export type EvidenceConfidence = "high" | "medium" | "low"

export type EvidenceItem = {
  readonly id: string
  readonly kind: EvidenceKind
  readonly source: string
  readonly detail: string
  readonly exitCode?: number
  readonly timestamp: number
  readonly rawOutput?: string
  readonly structuredResult?: Record<string, unknown>
  readonly confidence?: EvidenceConfidence
  readonly verifiable?: boolean
  readonly tool?: string
  readonly params?: unknown
  readonly observation?: unknown
  readonly hash?: string
}

export type EvidenceRecord = EvidenceItem

export type ClaimType =
  | "file_exists"
  | "test_passes"
  | "typecheck_clean"
  | "build_succeeds"
  | "behavior_verified"
  | "edge_case_handled"

export type ClaimStatus = "VERIFIED" | "UNVERIFIED" | "INVALIDATED"

export type ClaimRecord = {
  readonly id: string
  readonly type: ClaimType
  readonly statement: string
  readonly status: ClaimStatus
  readonly evidenceIds: readonly string[]
  readonly timestamp: number
  readonly target?: string
  readonly staleAfter?: number
}

export type VerificationClause = {
  readonly requiredAnyOf: readonly EvidenceKind[]
  readonly description: string
}

export type VerificationResult = {
  readonly satisfied: boolean
  readonly missing: readonly string[]
  readonly satisfiedItems: readonly EvidenceItem[]
}

export interface ClaimEvidenceBinding {
  claimId: string
  evidenceId: string
  boundAt: number
}

export class EvidenceTamperingError extends Error {
  readonly _tag = "EvidenceTamperingError"
  constructor(public readonly evidenceId: string) {
    super(`Evidence item ${evidenceId} is immutable and cannot be overwritten or modified.`)
  }
}

export class AcceptanceVerificationError extends Error {
  readonly _tag = "AcceptanceVerificationError"
  constructor(public readonly unverifiedCriteria: string[]) {
    super(`Task acceptance criteria incomplete. Unverified: ${unverifiedCriteria.join(", ")}`)
  }
}

export * as EvidenceTypes from "./types"
