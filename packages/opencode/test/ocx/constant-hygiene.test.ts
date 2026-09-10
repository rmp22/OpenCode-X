import { describe, expect, test } from "bun:test"
import {
  evaluateSemanticLiteral,
  registerDomainConstant,
  getRegisteredConstants,
} from "@/ocx/policy"

describe("Semantic Literal & Constant Hygiene", () => {
  test("Case A: detects duplicate of existing canonical symbol as ERROR", () => {
    const finding = evaluateSemanticLiteral(100000)
    expect(finding.classification).toBe("REUSE_EXISTING")
    expect(finding.severity).toBe("ERROR")
    expect(finding.suggestedSymbol).toBe("DEFAULT_GRAPH_TOKEN_BUDGET")
    expect(finding.ownerModule).toBe("@/ocx/graph")

    const strFinding = evaluateSemanticLiteral("verification_failure")
    expect(strFinding.classification).toBe("REUSE_EXISTING")
    expect(strFinding.severity).toBe("ERROR")
    expect(strFinding.suggestedSymbol).toBe("SUSPENSION_KIND_VERIFICATION_FAILURE")
  })

  test("Case B: flags undeclared magic threshold as DEFINE_DOMAIN_CONSTANT ADVISORY", () => {
    const finding = evaluateSemanticLiteral(45000)
    expect(finding.classification).toBe("DEFINE_DOMAIN_CONSTANT")
    expect(finding.severity).toBe("ADVISORY")
    expect(finding.reason).toContain("named domain constant")
  })

  test("Case C: flags environment/tunable setting as USE_CONFIG", () => {
    const finding = evaluateSemanticLiteral("http://localhost:8080/api", { isConfigurable: true })
    expect(finding.classification).toBe("USE_CONFIG")
    expect(finding.severity).toBe("ADVISORY")
    expect(finding.reason).toContain("configuration")
  })

  test("Case D: allows trivial boundary values, arithmetic, and syntax literals inline", () => {
    const zeroFinding = evaluateSemanticLiteral(0)
    expect(zeroFinding.classification).toBe("ALLOW_INLINE")
    expect(zeroFinding.severity).toBe("ALLOW")

    const oneFinding = evaluateSemanticLiteral(1)
    expect(oneFinding.classification).toBe("ALLOW_INLINE")
    expect(oneFinding.severity).toBe("ALLOW")

    const negOneFinding = evaluateSemanticLiteral(-1)
    expect(negOneFinding.classification).toBe("ALLOW_INLINE")
    expect(negOneFinding.severity).toBe("ALLOW")

    const arithmeticFinding = evaluateSemanticLiteral(2, { isArithmetic: true })
    expect(arithmeticFinding.classification).toBe("ALLOW_INLINE")
    expect(arithmeticFinding.severity).toBe("ALLOW")
  })

  test("allows registration of new domain constants at subsystem owners", () => {
    registerDomainConstant({
      symbol: "ORACLE_MAX_DIFF_LINES",
      value: 500,
      ownerModule: "@/ocx/verification",
      description: "Maximum lines inspected by verification oracle",
    })

    const registered = getRegisteredConstants()
    expect(registered.some((c) => c.symbol === "ORACLE_MAX_DIFF_LINES")).toBe(true)

    const finding = evaluateSemanticLiteral(500)
    expect(finding.classification).toBe("REUSE_EXISTING")
    expect(finding.suggestedSymbol).toBe("ORACLE_MAX_DIFF_LINES")
  })
})
