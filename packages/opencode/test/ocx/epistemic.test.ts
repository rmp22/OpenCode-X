import { describe, expect, test } from "bun:test"
import {
  parseClaimsFromText,
  extractCitations,
  extractSpeculativePhrases,
  verifyClaims,
  enforceEpistemicBarrier,
  EpistemicBarrierViolationError,
} from "@/ocx/epistemic"

describe("Epistemic Engine", () => {
  test("extracts speculative phrases and citations", () => {
    const text = "I assume the config is at package.json:10 and likely works."
    const phrases = extractSpeculativePhrases(text)
    expect(phrases).toContain("i assume")
    expect(phrases).toContain("likely")

    const citations = extractCitations(text)
    expect(citations).toHaveLength(1)
    expect(citations[0].filePath).toBe("package.json")
    expect(citations[0].lineNumber).toBe(10)
  })

  test("parses structured claims from output", () => {
    const output = `
VERIFIED: package.json:1 has version field
UNVERIFIED: foo.ts has helper function
`
    const claims = parseClaimsFromText(output)
    expect(claims).toHaveLength(2)
    expect(claims[0].state).toBe("verified")
    expect(claims[1].state).toBe("unverified")
  })

  test("verifies citations against real disk state", async () => {
    const claims = parseClaimsFromText("VERIFIED: package.json:1 has name")
    const report = await verifyClaims(claims)
    expect(report.passed).toBe(true)
    expect(report.verifiedClaims).toBe(1)
    expect(report.falsifiedClaims).toBe(0)
  })

  test("falsifies claims with non-existent files", async () => {
    const claims = parseClaimsFromText("VERIFIED: non-existent-path-xyz.ts:50 does something")
    const report = await verifyClaims(claims)
    expect(report.falsifiedClaims).toBe(1)
    expect(report.passed).toBe(false)
  })

  test("enforces barrier blocking on falsified or unverified claims in verification phase", async () => {
    const claims = parseClaimsFromText("I assume non-existent-xyz.ts:1 is good")
    await expect(enforceEpistemicBarrier(claims, undefined, { isVerificationPhase: true })).rejects.toThrow(
      EpistemicBarrierViolationError,
    )
  })
})
