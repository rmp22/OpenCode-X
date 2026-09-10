import type { Claim, EpistemicBarrierConfig, VerificationReport } from "./types"
import { verifyClaims } from "./verifier"

export class EpistemicBarrierViolationError extends Error {
  readonly _tag = "EpistemicBarrierViolationError"
  constructor(public readonly report: VerificationReport) {
    super(`Epistemic barrier violation: ${report.violations.join("; ")}`)
  }
}

export async function enforceEpistemicBarrier(
  claims: Claim[],
  config?: Partial<EpistemicBarrierConfig>,
  options?: { isVerificationPhase?: boolean },
): Promise<VerificationReport> {
  const maxUnverified = config?.maxUnverifiedClaims ?? (options?.isVerificationPhase ? 0 : 3)
  const report = await verifyClaims(claims, options)

  if (report.falsifiedClaims > 0) {
    throw new EpistemicBarrierViolationError(report)
  }

  if (report.unverifiedClaims > maxUnverified) {
    report.violations.push(
      `Unverified claim count (${report.unverifiedClaims}) exceeds allowed budget (${maxUnverified})`,
    )
    throw new EpistemicBarrierViolationError(report)
  }

  if (options?.isVerificationPhase && report.speculativeCount > 0) {
    throw new EpistemicBarrierViolationError(report)
  }

  return report
}
