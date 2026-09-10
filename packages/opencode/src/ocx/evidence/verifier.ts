import type { EvidenceItem, EvidenceKind, ClaimRecord } from "./types"

type RequirementClause = readonly EvidenceKind[]

const PIPELINE_REQUIREMENTS: Record<string, readonly RequirementClause[]> = {
  "code-mutation-pipeline": [
    ["diff_inspection"],
    ["test_run", "typecheck"],
  ],
  "interactive-exploration-pipeline": [
    ["read_artifact"],
  ],
  "systematic-investigation-pipeline": [
    ["read_artifact"],
  ],
  "documentation-pipeline": [
    ["diff_inspection"],
  ],
  "security-remediation-pipeline": [
    ["diff_inspection"],
    ["test_run", "typecheck"],
  ],
}

export class EvidenceVerifier {
  static requirementsFor(pipelineId: string): readonly RequirementClause[] {
    return PIPELINE_REQUIREMENTS[pipelineId] ?? [["read_artifact", "diff_inspection"]]
  }

  static verify(
    pipelineId: string,
    evidenceItems: readonly EvidenceItem[],
  ): {
    readonly satisfied: boolean
    readonly missing: readonly string[]
    readonly satisfiedItems: readonly EvidenceItem[]
  } {
    const clauses = EvidenceVerifier.requirementsFor(pipelineId)
    const availableKinds = new Set(evidenceItems.map((item) => item.kind))
    const missing: string[] = []
    const satisfiedItems: EvidenceItem[] = []

    for (const clause of clauses) {
      const matchedKind = clause.find((kind) => availableKinds.has(kind))
      if (!matchedKind) {
        missing.push(`Requires at least one of: [${clause.join(" OR ")}]`)
      } else {
        for (const item of evidenceItems) {
          if (item.kind === matchedKind && !satisfiedItems.includes(item)) {
            satisfiedItems.push(item)
          }
        }
      }
    }

    const result = {
      satisfied: missing.length === 0,
      missing,
      satisfiedItems,
    }
    return result
  }

  static verifyClaim(
    claim: ClaimRecord,
    evidenceItems: readonly EvidenceItem[],
    options: { readonly maxAgeMs?: number } = {},
  ): ClaimRecord {
    if (!claim.evidenceIds || claim.evidenceIds.length === 0) {
      const unverified: ClaimRecord = { ...claim, status: "UNVERIFIED" }
      return unverified
    }

    const boundItems = evidenceItems.filter((e) => claim.evidenceIds.includes(e.id))
    if (boundItems.length === 0) {
      const unverified: ClaimRecord = { ...claim, status: "UNVERIFIED" }
      return unverified
    }

    const now = Date.now()
    const maxAge = options.maxAgeMs ?? 1000 * 60 * 60
    const hasStale = boundItems.some((e) => {
      if (claim.staleAfter && now > claim.staleAfter) return true
      return now - e.timestamp > maxAge
    })
    if (hasStale) {
      const unverified: ClaimRecord = { ...claim, status: "UNVERIFIED" }
      return unverified
    }

    for (const item of boundItems) {
      if (item.exitCode !== undefined && item.exitCode !== 0) {
        const invalidated: ClaimRecord = { ...claim, status: "INVALIDATED" }
        return invalidated
      }
      const raw = (item.rawOutput ?? item.detail ?? "").toLowerCase()
      if (claim.type === "test_passes") {
        if (raw.includes("fail") && !raw.includes("0 fail")) {
          const invalidated: ClaimRecord = { ...claim, status: "INVALIDATED" }
          return invalidated
        }
      } else if (claim.type === "typecheck_clean") {
        if (raw.includes("error ts")) {
          const invalidated: ClaimRecord = { ...claim, status: "INVALIDATED" }
          return invalidated
        }
      } else if (claim.type === "file_exists") {
        if (raw.includes("enoent") || raw.includes("not found")) {
          const invalidated: ClaimRecord = { ...claim, status: "INVALIDATED" }
          return invalidated
        }
      }
    }

    const verified: ClaimRecord = { ...claim, status: "VERIFIED" }
    return verified
  }

  static bindClaim(
    claimData: Omit<ClaimRecord, "status" | "evidenceIds">,
    evidenceIds: readonly string[],
    evidenceItems: readonly EvidenceItem[],
    options: { readonly maxAgeMs?: number } = {},
  ): ClaimRecord {
    const claim: ClaimRecord = {
      ...claimData,
      status: "UNVERIFIED",
      evidenceIds,
    }
    return EvidenceVerifier.verifyClaim(claim, evidenceItems, options)
  }
}

export * as EvidenceVerifierModule from "./verifier"
