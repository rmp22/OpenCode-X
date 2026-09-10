import { describe, expect, test } from "bun:test"
import {
  evaluateLadder,
  evaluateCompositeClaim,
  evaluateWorkItemChecks,
  type LadderRung,
} from "@/ocx/verification"
import type { EvidenceItem } from "@/ocx/evidence"
import type { CheckItem } from "@/ocx/work"

describe("Verification Ladder & Acceptance Checks", () => {
  const diffEvidence: EvidenceItem = {
    id: "ev_diff",
    kind: "diff_inspection",
    source: "edit:auth.ts",
    detail: "auth diff",
    rawOutput: "diff --git a/auth.ts",
    exitCode: 0,
    timestamp: Date.now(),
    confidence: "high",
  }

  const typecheckEvidence: EvidenceItem = {
    id: "ev_tc",
    kind: "typecheck",
    source: "bun typecheck",
    detail: "clean",
    rawOutput: "tsgo --noEmit: clean",
    exitCode: 0,
    timestamp: Date.now(),
    confidence: "high",
  }

  const unitTestEvidence: EvidenceItem = {
    id: "ev_ut",
    kind: "test_run",
    source: "bun test test/unit/auth.test.ts",
    detail: "10 pass, 0 fail",
    rawOutput: "10 pass, 0 fail",
    exitCode: 0,
    timestamp: Date.now(),
    confidence: "high",
  }

  test("ladder evaluation succeeds when all target rungs are satisfied in order", () => {
    const targetRungs: LadderRung[] = ["syntax", "typecheck", "unit_test"]
    const evidenceList = [diffEvidence, typecheckEvidence, unitTestEvidence]

    const result = evaluateLadder(targetRungs, evidenceList)
    expect(result.completed).toBe(true)
    expect(result.highestPassedRung).toBe("unit_test")
    expect(result.lowestFailingRung).toBeUndefined()
    expect(result.evaluations.length).toBe(3)
    expect(result.aggregatedEvidenceIds).toContain("ev_diff")
    expect(result.aggregatedEvidenceIds).toContain("ev_tc")
    expect(result.aggregatedEvidenceIds).toContain("ev_ut")
  })

  test("ladder short-circuits and stops at lowest failing rung", () => {
    const failingTypecheck: EvidenceItem = {
      id: "ev_tc_fail",
      kind: "typecheck",
      source: "bun typecheck",
      detail: "type error",
      rawOutput: "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      exitCode: 1,
      timestamp: Date.now(),
    }

    const targetRungs: LadderRung[] = ["syntax", "typecheck", "unit_test"]
    const evidenceList = [diffEvidence, failingTypecheck, unitTestEvidence]

    const result = evaluateLadder(targetRungs, evidenceList)
    expect(result.completed).toBe(false)
    expect(result.lowestFailingRung).toBe("typecheck")
    expect(result.highestPassedRung).toBe("syntax")
    expect(result.evaluations.length).toBe(2)
    expect(result.evaluations.some((e) => e.rung === "unit_test")).toBe(false)
    expect(result.failureReason).toContain("typecheck")
  })

  test("ladder short-circuits when required evidence is missing for a rung", () => {
    const targetRungs: LadderRung[] = ["syntax", "typecheck", "unit_test"]
    const evidenceList = [diffEvidence]

    const result = evaluateLadder(targetRungs, evidenceList)
    expect(result.completed).toBe(false)
    expect(result.lowestFailingRung).toBe("typecheck")
    expect(result.evaluations.length).toBe(2)
    expect(result.evaluations[1].passed).toBe(false)
    expect(result.failureReason).toContain("Missing required evidence")
  })

  test("composite claim aggregates multiple evidence items into verified claim", () => {
    const evidenceList = [diffEvidence, typecheckEvidence, unitTestEvidence]

    const compositeDef = {
      claimId: "claim_full_ci",
      statement: "Auth module passes full CI ladder",
      requiredRungs: ["syntax", "typecheck", "unit_test"] as LadderRung[],
    }

    const result = evaluateCompositeClaim(compositeDef, evidenceList)
    expect(result.satisfied).toBe(true)
    expect(result.boundClaim.status).toBe("VERIFIED")
    expect(result.boundClaim.evidenceIds).toContain("ev_diff")
    expect(result.boundClaim.evidenceIds).toContain("ev_tc")
    expect(result.boundClaim.evidenceIds).toContain("ev_ut")
  })

  test("composite claim marks claim UNVERIFIED when ladder fails", () => {
    const compositeDef = {
      claimId: "claim_full_ci",
      statement: "Auth module passes full CI ladder",
      requiredRungs: ["syntax", "typecheck", "unit_test"] as LadderRung[],
    }

    const result = evaluateCompositeClaim(compositeDef, [diffEvidence])
    expect(result.satisfied).toBe(false)
    expect(result.boundClaim.status).toBe("UNVERIFIED")
  })

  test("evaluates work item acceptance checks against collected evidence", () => {
    const checks: CheckItem[] = [
      { id: "c1", description: "Run typecheck", status: "pending" },
      { id: "c2", description: "Run unit test suite", status: "pending" },
      { id: "c3", description: "Custom waived check", status: "waived" },
    ]

    const evidenceList = [typecheckEvidence, unitTestEvidence]
    const result = evaluateWorkItemChecks(checks, evidenceList)

    expect(result.allPassed).toBe(true)
    expect(result.evaluatedChecks[0].status).toBe("pass")
    expect(result.evaluatedChecks[0].boundEvidenceIds).toContain("ev_tc")
    expect(result.evaluatedChecks[1].status).toBe("pass")
    expect(result.evaluatedChecks[1].boundEvidenceIds).toContain("ev_ut")
  })
})
