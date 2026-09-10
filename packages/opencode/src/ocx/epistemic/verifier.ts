import type { Claim, VerificationReport } from "./types"

export interface CitationCheckResult {
  filePath: string
  lineNumber?: number
  verified: boolean
  failureReason?: string
}

export async function verifyCitation(filePath: string, lineNumber?: number): Promise<CitationCheckResult> {
  try {
    const file = Bun.file(filePath)
    const exists = await file.exists()
    if (!exists) {
      return {
        filePath,
        lineNumber,
        verified: false,
        failureReason: `Path does not exist on disk: ${filePath}`,
      }
    }

    if (lineNumber !== undefined) {
      const content = await file.text()
      const lineCount = content.split("\n").length
      if (lineNumber < 1 || lineNumber > lineCount) {
        return {
          filePath,
          lineNumber,
          verified: false,
          failureReason: `Line number ${lineNumber} out of range (file has ${lineCount} lines)`,
        }
      }
    }

    return {
      filePath,
      lineNumber,
      verified: true,
    }
  } catch (err) {
    return {
      filePath,
      lineNumber,
      verified: false,
      failureReason: String(err),
    }
  }
}

export async function verifyClaims(
  claims: Claim[],
  options?: { isVerificationPhase?: boolean },
): Promise<VerificationReport> {
  let verifiedCount = 0
  let unverifiedCount = 0
  let falsifiedCount = 0
  let speculativeCount = 0
  const violations: string[] = []

  for (const claim of claims) {
    if (claim.speculativePhrases.length > 0) {
      speculativeCount += claim.speculativePhrases.length
      if (options?.isVerificationPhase) {
        violations.push(
          `Speculative language detected in verification phase: "${claim.speculativePhrases.join(", ")}" in "${claim.text}"`,
        )
      }
    }

    let hasFailure = false
    let allCitationsValid = claim.citations.length > 0

    for (const citation of claim.citations) {
      const result = await verifyCitation(citation.filePath, citation.lineNumber)
      citation.verified = result.verified
      citation.failureReason = result.failureReason

      if (!result.verified) {
        hasFailure = true
        allCitationsValid = false
        violations.push(`Invalid citation in claim "${claim.text}": ${result.failureReason}`)
      }
    }

    if (hasFailure) {
      claim.state = "falsified"
      falsifiedCount++
    } else if (allCitationsValid || claim.state === "verified") {
      claim.state = "verified"
      verifiedCount++
    } else {
      claim.state = "unverified"
      unverifiedCount++
    }
  }

  const passed = violations.length === 0 && falsifiedCount === 0 && (options?.isVerificationPhase ? speculativeCount === 0 : true)

  return {
    totalClaims: claims.length,
    verifiedClaims: verifiedCount,
    unverifiedClaims: unverifiedCount,
    falsifiedClaims: falsifiedCount,
    speculativeCount,
    violations,
    passed,
  }
}
