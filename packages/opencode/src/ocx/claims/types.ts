export type ClaimStatus = "asserted" | "verified" | "refuted" | "unverified"

export type Citation = {
  readonly filePath: string
  readonly lineNumber: number
}

export type StructuredClaim = {
  readonly id: string
  readonly nodeId: string
  readonly stepId?: string
  readonly assertion: string
  readonly status: ClaimStatus
  readonly evidenceIds: readonly string[]
  readonly citations: readonly Citation[]
  readonly createdAt: number
  readonly verifiedAt?: number
  readonly refutationReason?: string
}

export type VerifyClaimResult =
  | { readonly success: true; readonly claim: StructuredClaim }
  | { readonly success: false; readonly reason: string }

export * as ClaimTypes from "./types"
