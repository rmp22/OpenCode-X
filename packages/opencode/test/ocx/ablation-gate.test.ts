import { describe, expect, test } from "bun:test"
import {
  evaluateReleaseGate,
  CANONICAL_MECHANISMS,
  type MechanismRecord,
} from "@/ocx/eval"

describe("Mechanism Ablation & Release Gate", () => {
  test("approves release for canonical mechanism configuration", () => {
    const decision = evaluateReleaseGate(CANONICAL_MECHANISMS)
    expect(decision.approvedForRelease).toBe(true)
    expect(decision.blockingFailures.length).toBe(0)
    expect(decision.activeMechanismsCount).toBeGreaterThanOrEqual(7)
    expect(decision.disabledOrNarrowedCount).toBeGreaterThanOrEqual(3)
  })

  test("blocks release if an active mechanism introduces regressions", () => {
    const regressedMechanisms: MechanismRecord[] = [
      ...CANONICAL_MECHANISMS.map((m) =>
        m.id === "mech_anti_slop" ? { ...m, regressionsCount: 2 } : m,
      ),
    ]

    const decision = evaluateReleaseGate(regressedMechanisms)
    expect(decision.approvedForRelease).toBe(false)
    expect(decision.blockingFailures.some((f) => f.includes("Anti-Slop Reviewer"))).toBe(true)
    expect(decision.blockingFailures.some((f) => f.includes("regressions"))).toBe(true)
  })

  test("blocks release if an active mechanism performs worse than baseline", () => {
    const degradedMechanisms: MechanismRecord[] = [
      ...CANONICAL_MECHANISMS.map((m) =>
        m.id === "mech_claim_verifier" ? { ...m, baselineScore: 0.9, treatmentScore: 0.7 } : m,
      ),
    ]

    const decision = evaluateReleaseGate(degradedMechanisms)
    expect(decision.approvedForRelease).toBe(false)
    expect(decision.blockingFailures.some((f) => f.includes("worse than baseline"))).toBe(true)
  })

  test("canonical mechanisms have honest calibration provenance", () => {
    for (const mech of CANONICAL_MECHANISMS) {
      expect(mech.isEmpirical).toBe(false)
      expect(mech.provenance?.kind).toBe("calibration_prior")
    }
  })
})
