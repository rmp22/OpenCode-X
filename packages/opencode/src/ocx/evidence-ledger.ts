export type EvidenceKind = "test" | "typecheck" | "lint" | "semantic" | "render"

export interface VerificationEvidence {
  readonly checkId: string
  readonly kind: EvidenceKind
  readonly target: string
  readonly passed: boolean
  readonly output?: string
  readonly errorSignature?: string
  readonly timestamp: number
}

export interface VerificationRequirement {
  readonly checkId?: string
  readonly kind?: EvidenceKind
  readonly target?: string
}

export function matchVerificationRequirement(
  evidence: VerificationEvidence,
  requirement: VerificationRequirement,
): boolean {
  if (requirement.checkId && evidence.checkId !== requirement.checkId) return false
  if (requirement.kind && evidence.kind !== requirement.kind) return false
  if (requirement.target && evidence.target !== requirement.target) return false
  return true
}

export class EvidenceLedger {
  private readonly records: VerificationEvidence[] = []

  record(evidence: VerificationEvidence) {
    this.records.push(evidence)
  }

  getEntries(): readonly VerificationEvidence[] {
    return [...this.records]
  }

  hasPassed(requirement: VerificationRequirement): boolean {
    return this.records.some((e) => matchVerificationRequirement(e, requirement) && e.passed)
  }

  getLatestFailure(): VerificationEvidence | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (!this.records[i].passed) return this.records[i]
    }
    return undefined
  }

  clear() {
    this.records.length = 0
  }
}

export * as EvidenceLedgerModule from "./evidence-ledger"
