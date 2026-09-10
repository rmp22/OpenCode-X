import type { EvidenceItem, EvidenceKind, ClaimRecord } from "../evidence"
import type { CheckItem } from "../work/model"

export type LadderRung =
  | "syntax"
  | "typecheck"
  | "unit_test"
  | "integration_test"
  | "invariant"
  | "render_golden"

export const LADDER_RUNGS_ORDER: readonly LadderRung[] = [
  "syntax",
  "typecheck",
  "unit_test",
  "integration_test",
  "invariant",
  "render_golden",
]

export const RUNG_EVIDENCE_REQUIREMENTS: Record<LadderRung, readonly EvidenceKind[]> = {
  syntax: ["read_artifact", "diff_inspection"],
  typecheck: ["typecheck"],
  unit_test: ["test_run"],
  integration_test: ["test_run"],
  invariant: ["diff_inspection", "lint_check", "read_artifact"],
  render_golden: ["read_artifact", "runtime_log"],
}

export type RungEvaluation = {
  readonly rung: LadderRung
  readonly passed: boolean
  readonly evidenceIds: readonly string[]
  readonly failureReason?: string
}

export type VerificationEvidence = {
  readonly id: string
  readonly rung: LadderRung
  readonly type?: string
  readonly target?: string
  readonly result?: "pass" | "fail"
  readonly timestamp?: number
}

export type EvaluateLadderOptions = {
  readonly targetRungs: readonly LadderRung[]
  readonly evidences: readonly (EvidenceItem | VerificationEvidence)[]
  readonly customEvaluators?: Partial<
    Record<LadderRung, (items: readonly EvidenceItem[]) => { readonly passed: boolean; readonly reason?: string }>
  >
}

export type LadderEvaluationResult = {
  readonly completed: boolean
  readonly satisfied: boolean
  readonly missingRungs: readonly LadderRung[]
  readonly highestPassedRung?: LadderRung
  readonly lowestFailingRung?: LadderRung
  readonly evaluations: readonly RungEvaluation[]
  readonly aggregatedEvidenceIds: readonly string[]
  readonly failureReason?: string
}

export function evaluateLadder(
  targetRungsOrOptions: readonly LadderRung[] | EvaluateLadderOptions,
  evidenceItems?: readonly (EvidenceItem | VerificationEvidence)[],
  customEvaluators?: Partial<
    Record<LadderRung, (items: readonly EvidenceItem[]) => { readonly passed: boolean; readonly reason?: string }>
  >,
): LadderEvaluationResult {
  let targetRungs: readonly LadderRung[]
  let evidenceList: readonly (EvidenceItem | VerificationEvidence)[]
  let evaluators = customEvaluators

  if ("targetRungs" in targetRungsOrOptions) {
    targetRungs = targetRungsOrOptions.targetRungs
    evidenceList = targetRungsOrOptions.evidences
    evaluators = targetRungsOrOptions.customEvaluators ?? customEvaluators
  } else {
    targetRungs = targetRungsOrOptions
    evidenceList = evidenceItems ?? []
  }
  const evaluations: RungEvaluation[] = []
  const aggregatedEvidenceIds: string[] = []
  const orderedTargets = LADDER_RUNGS_ORDER.filter((r) => targetRungs.includes(r))

  for (const rung of orderedTargets) {
    const requiredKinds = RUNG_EVIDENCE_REQUIREMENTS[rung]
    const matchingEvidence = evidenceList.filter((e) => {
      if ("rung" in e && e.rung !== undefined) {
        return e.rung === rung
      }
      return "kind" in e && requiredKinds.includes(e.kind)
    })

    if (matchingEvidence.length === 0) {
      const evalFailure: RungEvaluation = {
        rung,
        passed: false,
        evidenceIds: [],
        failureReason: "Missing required evidence [" + requiredKinds.join(" | ") + "] for rung " + rung,
      }
      evaluations.push(evalFailure)
      const passedEvals = evaluations.filter((e) => e.passed)
      const highestPassed = passedEvals.length > 0 ? passedEvals[passedEvals.length - 1].rung : undefined
      const missingRungs = orderedTargets.filter((r) => !evaluations.some((ev) => ev.rung === r && ev.passed))
      const ladderResult: LadderEvaluationResult = {
        completed: false,
        satisfied: false,
        missingRungs,
        lowestFailingRung: rung,
        highestPassedRung: highestPassed,
        evaluations,
        aggregatedEvidenceIds,
        failureReason: evalFailure.failureReason,
      }
      return ladderResult
    }

    const hasFailure = matchingEvidence.some((e) => {
      if ("result" in e && e.result !== undefined) {
        return e.result !== "pass"
      }
      if ("exitCode" in e && e.exitCode !== undefined && e.exitCode !== 0) return true
      const raw = ("rawOutput" in e && e.rawOutput ? e.rawOutput : "detail" in e && e.detail ? e.detail : "").toLowerCase()
      if (rung === "typecheck" && raw.includes("error ts")) return true
      if ((rung === "unit_test" || rung === "integration_test") && raw.includes("fail") && !raw.includes("0 fail")) {
        return true
      }
      return false
    })

    if (hasFailure) {
      const evalFailure: RungEvaluation = {
        rung,
        passed: false,
        evidenceIds: matchingEvidence.map((e) => e.id),
        failureReason: "Evidence for rung " + rung + " indicated execution failure",
      }
      evaluations.push(evalFailure)
      const passedEvals = evaluations.filter((e) => e.passed)
      const highestPassed = passedEvals.length > 0 ? passedEvals[passedEvals.length - 1].rung : undefined
      const missingRungs = orderedTargets.filter((r) => !evaluations.some((ev) => ev.rung === r && ev.passed))
      const ladderResult: LadderEvaluationResult = {
        completed: false,
        satisfied: false,
        missingRungs,
        lowestFailingRung: rung,
        highestPassedRung: highestPassed,
        evaluations,
        aggregatedEvidenceIds,
        failureReason: evalFailure.failureReason,
      }
      return ladderResult
    }

    if (evaluators && evaluators[rung]) {
      const customRes = evaluators[rung]!(matchingEvidence as readonly EvidenceItem[])
      if (!customRes.passed) {
        const evalFailure: RungEvaluation = {
          rung,
          passed: false,
          evidenceIds: matchingEvidence.map((e) => e.id),
          failureReason: customRes.reason ?? "Custom validation for rung " + rung + " failed",
        }
        evaluations.push(evalFailure)
        const passedEvals = evaluations.filter((e) => e.passed)
        const highestPassed = passedEvals.length > 0 ? passedEvals[passedEvals.length - 1].rung : undefined
        const missingRungs = orderedTargets.filter((r) => !evaluations.some((ev) => ev.rung === r && ev.passed))
        const ladderResult: LadderEvaluationResult = {
          completed: false,
          satisfied: false,
          missingRungs,
          lowestFailingRung: rung,
          highestPassedRung: highestPassed,
          evaluations,
          aggregatedEvidenceIds,
          failureReason: evalFailure.failureReason,
        }
        return ladderResult
      }
    }

    const rungEvidenceIds = matchingEvidence.map((e) => e.id)
    aggregatedEvidenceIds.push(...rungEvidenceIds)
    const passedEval: RungEvaluation = {
      rung,
      passed: true,
      evidenceIds: rungEvidenceIds,
    }
    evaluations.push(passedEval)
  }

  const uniqueEvidenceIds = Array.from(new Set(aggregatedEvidenceIds))
  const ladderResult: LadderEvaluationResult = {
    completed: true,
    satisfied: true,
    missingRungs: [],
    highestPassedRung: orderedTargets.length > 0 ? orderedTargets[orderedTargets.length - 1] : undefined,
    evaluations,
    aggregatedEvidenceIds: uniqueEvidenceIds,
  }
  return ladderResult
}

export type CompositeClaimDefinition = {
  readonly claimId: string
  readonly statement: string
  readonly requiredRungs: readonly LadderRung[]
  readonly acceptanceCheckIds?: readonly string[]
}

export function evaluateCompositeClaim(
  composite: CompositeClaimDefinition,
  evidenceItems: readonly EvidenceItem[],
): {
  readonly satisfied: boolean
  readonly ladderResult: LadderEvaluationResult
  readonly boundClaim: ClaimRecord
} {
  const ladderResult = evaluateLadder(composite.requiredRungs, evidenceItems)
  if (!ladderResult.completed) {
    const boundClaim: ClaimRecord = {
      id: composite.claimId,
      type: "behavior_verified",
      statement: composite.statement,
      status: "UNVERIFIED",
      evidenceIds: ladderResult.aggregatedEvidenceIds,
      timestamp: Date.now(),
    }
    const result = {
      satisfied: false,
      ladderResult,
      boundClaim,
    }
    return result
  }

  const boundClaim: ClaimRecord = {
    id: composite.claimId,
    type: "behavior_verified",
    statement: composite.statement,
    status: "VERIFIED",
    evidenceIds: ladderResult.aggregatedEvidenceIds,
    timestamp: Date.now(),
  }
  const result = {
    satisfied: true,
    ladderResult,
    boundClaim,
  }
  return result
}

export function evaluateWorkItemChecks(
  checks: readonly CheckItem[],
  evidenceItems: readonly EvidenceItem[],
): {
  readonly allPassed: boolean
  readonly evaluatedChecks: readonly (CheckItem & { readonly boundEvidenceIds: readonly string[] })[]
} {
  const evaluatedChecks = checks.map((chk) => {
    if (chk.status === "waived" || chk.status === "pass") {
      const passedItem = {
        ...chk,
        status: chk.status,
        boundEvidenceIds: chk.evidenceId ? [chk.evidenceId] : [],
      }
      return passedItem
    }
    const matching = evidenceItems.filter((e) => {
      const desc = chk.description.toLowerCase()
      const raw = (e.rawOutput ?? e.detail ?? "").toLowerCase()
      if (desc.includes("typecheck") && e.kind === "typecheck") return true
      if (desc.includes("test") && e.kind === "test_run") return true
      if (raw.includes(desc)) return true
      return false
    })

    const hasValidPass = matching.some((m) => m.exitCode === 0 || m.confidence === "high")
    const status = hasValidPass ? ("pass" as const) : ("pending" as const)
    const evaluatedItem = {
      ...chk,
      status,
      boundEvidenceIds: matching.map((m) => m.id),
    }
    return evaluatedItem
  })

  const allPassed = evaluatedChecks.every((c) => c.status === "pass" || c.status === "waived")
  const result = {
    allPassed,
    evaluatedChecks,
  }
  return result
}

export * as VerificationLadderModule from "./ladder"
