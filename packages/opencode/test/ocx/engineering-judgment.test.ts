import { describe, expect, test } from "bun:test"
import {
  classifyFailure,
  createDebuggingState,
  confirmHypothesis,
  eliminateHypothesis,
  canProceedToRepair,
} from "@/ocx/debugging"

describe("Engineering Judgment & Failure Classification", () => {
  test("classifies environment and permission failures and prohibits product mutation", () => {
    const envErr = classifyFailure({
      message: "connect ECONNREFUSED 127.0.0.1:5432",
    })
    expect(envErr.classification).toBe("environment")
    expect(envErr.allowProductMutation).toBe(false)
    expect(envErr.reason).toContain("do not mutate product code")

    const permErr = classifyFailure({
      message: "EACCES: permission denied, open '/etc/passwd'",
    })
    expect(permErr.classification).toBe("permission")
    expect(permErr.allowProductMutation).toBe(false)

    const depErr = classifyFailure({
      message: "Cannot find module '@opencode-ai/missing-pkg'",
    })
    expect(depErr.classification).toBe("dependency")
    expect(depErr.allowProductMutation).toBe(false)
  })

  test("classifies test and implementation errors and permits targeted mutation", () => {
    const testErr = classifyFailure({
      message: "AssertionError: expect(received).toBe(expected)",
      stdout: "1 fail, 2 pass",
    })
    expect(testErr.classification).toBe("test")
    expect(testErr.allowProductMutation).toBe(true)

    const implErr = classifyFailure({
      message: "TypeError: Cannot read properties of undefined (reading 'token')",
    })
    expect(implErr.classification).toBe("implementation")
    expect(implErr.allowProductMutation).toBe(true)
  })

  test("blocks speculative code repair when multiple hypotheses remain active without discriminating evidence", () => {
    const state = createDebuggingState({
      symptom: "Authentication token validation fails on mobile client",
      reproduction: "Run test/mobile-auth.test.ts",
      facts: [
        "Server returns 401 Unauthorized",
        "Headers contain Authorization: Bearer token",
      ],
      hypotheses: [
        {
          id: "h1",
          statement: "Clock skew causes exp claim to fail",
          status: "active",
          discriminatingCheck: "Inspect payload iat and exp vs server clock",
        },
        {
          id: "h2",
          statement: "Public key rotated and cache is stale",
          status: "active",
          discriminatingCheck: "Inspect kid header against JWKS endpoint",
        },
      ],
    })

    const check = canProceedToRepair(state)
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain("Uncertainty is material")
    expect(check.reason).toContain("discriminating evidence")
  })

  test("permits repair after discriminating evidence confirms root cause hypothesis", () => {
    const initial = createDebuggingState({
      symptom: "Token rejected",
      hypotheses: [
        { id: "h1", statement: "Clock skew", status: "active" },
        { id: "h2", statement: "Key rotation", status: "active" },
      ],
    })

    const confirmed = confirmHypothesis(
      initial,
      "h2",
      "ev_jwks_kid_mismatch",
      "JWKS cache contains key_2025 but client token uses kid key_2026",
    )

    expect(confirmed.hypotheses.find((h) => h.id === "h2")?.status).toBe("confirmed")
    expect(confirmed.hypotheses.find((h) => h.id === "h1")?.status).toBe("eliminated")
    expect(confirmed.diagnosis).toContain("kid key_2026")

    const check = canProceedToRepair(confirmed)
    expect(check.allowed).toBe(true)
  })

  test("supports hypothesis elimination with reason", () => {
    const initial = createDebuggingState({
      symptom: "Token rejected",
      hypotheses: [
        { id: "h1", statement: "Clock skew", status: "active" },
        { id: "h2", statement: "Key rotation", status: "active" },
      ],
    })

    const eliminated = eliminateHypothesis(
      initial,
      "h1",
      "Server timestamp is within 200ms of client iat",
    )

    const h1 = eliminated.hypotheses.find((h) => h.id === "h1")
    expect(h1?.status).toBe("eliminated")
    expect(h1?.eliminationReason).toContain("within 200ms")
  })
})
