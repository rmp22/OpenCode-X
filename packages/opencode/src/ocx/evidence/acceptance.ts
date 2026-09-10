import type { Requirement } from "../intent-model"
import { AcceptanceVerificationError, type ClaimEvidenceBinding } from "./types"
import type { ContentAddressableEvidenceStore } from "./store"

export class AcceptanceVerifier {
  private bindings: ClaimEvidenceBinding[] = []

  bindClaimEvidence(claimId: string, evidenceId: string): ClaimEvidenceBinding {
    const binding: ClaimEvidenceBinding = {
      claimId,
      evidenceId,
      boundAt: Date.now(),
    }
    this.bindings.push(binding)
    return binding
  }

  verifyTaskAcceptance(
    requirements: Requirement[],
    store: ContentAddressableEvidenceStore,
  ): { passed: boolean; unverified: string[] } {
    const unverified: string[] = []

    for (const req of requirements) {
      for (const criterion of req.criteria) {
        if (!criterion.verified || !criterion.evidence) {
          unverified.push(`${req.id}:${criterion.id} (${criterion.description})`)
          continue
        }

        if (criterion.evidence.startsWith("ev-")) {
          const existsInStore = store.has(criterion.evidence)
          if (!existsInStore) {
            unverified.push(`${req.id}:${criterion.id} (missing evidence in store: ${criterion.evidence})`)
          }
        }
      }
    }

    if (unverified.length > 0) {
      throw new AcceptanceVerificationError(unverified)
    }

    return { passed: true, unverified: [] }
  }

  getBindings(): ClaimEvidenceBinding[] {
    return [...this.bindings]
  }

  clear(): void {
    this.bindings = []
  }
}

export const defaultAcceptanceVerifier = new AcceptanceVerifier()
