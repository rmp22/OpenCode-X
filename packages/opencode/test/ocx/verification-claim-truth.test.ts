import { describe, expect, test } from "bun:test"
import { validateTextClaims } from "../../src/ocx/turn/claim"
import {
  evaluateLadder,
  type VerificationEvidence,
} from "../../src/ocx/verification/ladder"

describe("Verification & Claim Truth", () => {
  test("verified claim citing concrete file and line evidence is accepted", () => {
    const text = `
      VERIFIED: The authentication middleware validates JWT tokens src/auth/jwt.ts:45
      STATE: done
    `
    const findings = validateTextClaims(text)
    const unverifiedFinding = findings.find((f) => f.rule === "C-unsubstantiated-verified-claim")
    expect(unverifiedFinding).toBeUndefined()
  })

  test("verified claim citing test execution output is accepted", () => {
    const text = `
      VERIFIED: Test suite passes with 42 passed in 150ms
      STATE: done
    `
    const findings = validateTextClaims(text)
    const unverifiedFinding = findings.find((f) => f.rule === "C-unsubstantiated-verified-claim")
    expect(unverifiedFinding).toBeUndefined()
  })

  test("verified claim without empirical evidence triggers warning", () => {
    const text = `
      VERIFIED: The user interface looks gorgeous and everything works perfectly
    `
    const findings = validateTextClaims(text)
    const unverifiedFinding = findings.find((f) => f.rule === "C-unsubstantiated-verified-claim")
    expect(unverifiedFinding).toBeDefined()
    expect(unverifiedFinding?.fix).toContain("UNVERIFIED:")
  })

  test("claiming STATE: done is blocked when UNVERIFIED claims remain", () => {
    const text = `
      UNVERIFIED: Performance under high load is pending benchmark run
      STATE: done
    `
    const findings = validateTextClaims(text)
    const doneFinding = findings.find((f) => f.rule === "C-done-with-unverified-claims")
    expect(doneFinding).toBeDefined()
    expect(doneFinding?.severity).toBe("blocker")
  })

  test("verification ladder progression enforces lower rungs before higher rungs", () => {
    const onlyUnitTestEvidence: readonly VerificationEvidence[] = [
      {
        id: "ev-1",
        rung: "unit_test",
        type: "test_output",
        target: "test/auth.test.ts",
        result: "pass",
        timestamp: Date.now(),
      },
    ]

    const result = evaluateLadder({
      targetRungs: ["syntax", "unit_test"],
      evidences: onlyUnitTestEvidence,
    })

    expect(result.satisfied).toBe(false)
    expect(result.missingRungs).toContain("syntax")
  })

  test("verification ladder satisfies when all required rungs have passing evidence", () => {
    const fullEvidence: readonly VerificationEvidence[] = [
      {
        id: "ev-syntax",
        rung: "syntax",
        type: "build_output",
        target: "tsconfig.json",
        result: "pass",
        timestamp: Date.now(),
      },
      {
        id: "ev-unit",
        rung: "unit_test",
        type: "test_output",
        target: "test/auth.test.ts",
        result: "pass",
        timestamp: Date.now(),
      },
    ]

    const result = evaluateLadder({
      targetRungs: ["syntax", "unit_test"],
      evidences: fullEvidence,
    })

    expect(result.satisfied).toBe(true)
    expect(result.missingRungs.length).toBe(0)
  })
})
