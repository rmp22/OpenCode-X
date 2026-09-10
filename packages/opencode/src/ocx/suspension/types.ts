export type SuspensionKind =
  | "user_input"
  | "permission"
  | "rate_limit"
  | "circuit_breaker"
  | "review_approval"
  | "approval"
  | "review"
  | "verification_failure"

export type SuspensionRecord = {
  readonly id: string
  readonly kind: SuspensionKind
  readonly nodeId: string
  readonly sessionID: string
  readonly prompt: string
  readonly schema?: unknown
  readonly createdAt: number
  readonly status: "active" | "resumed" | "cancelled"
  readonly resumedAt?: number
  readonly resumePayload?: unknown
}

export type ResumeResult =
  | { readonly success: true; readonly suspension: SuspensionRecord }
  | { readonly success: false; readonly reason: string }

export * as SuspensionTypes from "./types"
