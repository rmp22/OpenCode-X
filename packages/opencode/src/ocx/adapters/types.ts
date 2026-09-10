export type DomainKind = "systems" | "backend" | "mobile" | "web" | "general"

export interface DomainDetectionContext {
  readonly files: readonly string[]
  readonly buildFiles: readonly string[]
  readonly languages: readonly string[]
  readonly promptText?: string
}

export interface DomainRuleViolation {
  readonly ruleId: string
  readonly message: string
  readonly severity: "warning" | "blocker"
  readonly file?: string
  readonly line?: number
  readonly fix?: string
}

export interface DomainVerificationResult {
  readonly domain: DomainKind
  readonly passed: boolean
  readonly violations: readonly DomainRuleViolation[]
  readonly metrics?: Record<string, number | string>
}

export interface DomainAdapter {
  readonly kind: DomainKind
  readonly name: string
  detect(context: DomainDetectionContext): boolean
  validateSource(file: string, content: string): readonly DomainRuleViolation[]
  verifyArtifact(target: string): Promise<DomainVerificationResult>
}

export * as DomainAdapterTypes from "./types"
