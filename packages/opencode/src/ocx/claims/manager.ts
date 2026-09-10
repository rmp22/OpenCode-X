import path from "path"
import {
  type Citation,
  type StructuredClaim,
  type VerifyClaimResult,
} from "./types"

export class ClaimLifecycleManager {
  private readonly claims = new Map<string, StructuredClaim>()
  private readonly evidenceRegistry = new Set<string>()

  registerEvidence(evidenceId: string): void {
    this.evidenceRegistry.add(evidenceId)
  }

  assert(options: {
    readonly nodeId: string
    readonly stepId?: string
    readonly assertion: string
    readonly citations?: readonly Citation[]
  }): StructuredClaim {
    const id = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const claim: StructuredClaim = {
      id,
      nodeId: options.nodeId,
      stepId: options.stepId,
      assertion: options.assertion,
      status: "asserted",
      evidenceIds: [],
      citations: options.citations ?? [],
      createdAt: Date.now(),
    }
    this.claims.set(id, claim)
    return claim
  }

  verify(claimId: string, evidenceIds: readonly string[]): VerifyClaimResult {
    const claim = this.claims.get(claimId)
    if (!claim) {
      const notFoundResult: VerifyClaimResult = {
        success: false,
        reason: `Claim ${claimId} does not exist`,
      }
      return notFoundResult
    }

    if (evidenceIds.length === 0) {
      const emptyEvidenceResult: VerifyClaimResult = {
        success: false,
        reason: "Cannot verify claim without at least one supporting evidence ID",
      }
      return emptyEvidenceResult
    }

    const missingEvidence = evidenceIds.filter((id) => !this.evidenceRegistry.has(id))
    if (missingEvidence.length > 0) {
      const missingResult: VerifyClaimResult = {
        success: false,
        reason: `Evidence IDs not registered in evidence pool: ${missingEvidence.join(", ")}`,
      }
      return missingResult
    }

    const updated: StructuredClaim = {
      ...claim,
      status: "verified",
      evidenceIds: [...evidenceIds],
      verifiedAt: Date.now(),
    }
    this.claims.set(claimId, updated)
    const successResult: VerifyClaimResult = {
      success: true,
      claim: updated,
    }
    return successResult
  }

  refute(claimId: string, reason: string): StructuredClaim {
    const claim = this.claims.get(claimId)
    if (!claim) {
      throw new Error(`Claim ${claimId} does not exist`)
    }
    const updated: StructuredClaim = {
      ...claim,
      status: "refuted",
      refutationReason: reason,
    }
    this.claims.set(claimId, updated)
    return updated
  }

  unverifiedClaims(nodeId?: string): readonly StructuredClaim[] {
    const list: StructuredClaim[] = []
    for (const claim of this.claims.values()) {
      const matchesNode = nodeId ? claim.nodeId === nodeId : true
      if (matchesNode && (claim.status === "asserted" || claim.status === "unverified")) {
        list.push(claim)
      }
    }
    return list
  }

  canComplete(nodeId?: string): { readonly allowed: boolean; readonly unverified: readonly StructuredClaim[] } {
    const unverified = this.unverifiedClaims(nodeId)
    const canCompleteResult = {
      allowed: unverified.length === 0,
      unverified,
    }
    return canCompleteResult
  }

  async verifyCitation(citation: Citation): Promise<boolean> {
    const resolvedPath = path.isAbsolute(citation.filePath)
      ? citation.filePath
      : path.resolve(process.cwd(), citation.filePath)
    const file = Bun.file(resolvedPath)
    if (!await file.exists()) return false
    const text = await file.text()
    const lines = text.split("\n")
    return citation.lineNumber >= 1 && citation.lineNumber <= lines.length
  }

  async verifyCitations(citations: readonly Citation[]): Promise<{ valid: boolean; failedCitations: readonly Citation[] }> {
    const failedCitations: Citation[] = []
    for (const citation of citations) {
      const isValid = await this.verifyCitation(citation)
      if (!isValid) failedCitations.push(citation)
    }
    const verificationResult = {
      valid: failedCitations.length === 0,
      failedCitations,
    }
    return verificationResult
  }

  formatClaimOutput(claim: StructuredClaim): string {
    const citations =
      claim.citations.length > 0
        ? ` (${claim.citations.map((c) => `${c.filePath}:${c.lineNumber}`).join(", ")})`
        : ""
    const result = `${claim.status === "verified" ? "VERIFIED:" : "UNVERIFIED:"} ${claim.assertion}${citations}`
    return result
  }
}

export const defaultClaimManager = new ClaimLifecycleManager()

export * as ClaimManagerModule from "./manager"
