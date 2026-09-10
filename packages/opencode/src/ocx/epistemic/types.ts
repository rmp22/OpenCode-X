export type EpistemicState = "verified" | "unverified" | "falsified"

export interface Citation {
  filePath: string
  lineNumber?: number
  verified: boolean
  failureReason?: string
}

export interface Claim {
  id: string
  text: string
  state: EpistemicState
  citations: Citation[]
  speculativePhrases: string[]
  evidenceRef?: string
}

export interface VerificationReport {
  totalClaims: number
  verifiedClaims: number
  unverifiedClaims: number
  falsifiedClaims: number
  speculativeCount: number
  violations: string[]
  passed: boolean
}

export interface EpistemicBarrierConfig {
  maxUnverifiedClaims: number
  allowSpeculationInVerification: boolean
}
