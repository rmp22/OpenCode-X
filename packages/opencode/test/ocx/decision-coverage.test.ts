import { describe, expect, test } from "bun:test"
import {
  evaluateDecisionCoverage,
  defaultRequiredDomainsFor,
  type DecisionRequirement,
  type CoverageEvidence,
} from "@/ocx/policy"

describe("Decision Coverage Prerequisites", () => {
  test("provides required domain universe for exposed API and negative caller decisions", () => {
    const domains = defaultRequiredDomainsFor("exposed_api_removal")
    expect(domains).toContain("defining_repo")
    expect(domains).toContain("local_callers")
    expect(domains).toContain("reflection_string_refs")
    expect(domains).toContain("external_reference_corpus")
    expect(domains).toContain("compatibility_consumers")
  })

  test("blocks deletion when required domains are missing from search coverage", () => {
    const requirement: DecisionRequirement = {
      decisionType: "exposed_api_removal",
      targetSymbol: "LegacyCryptoProvider.decryptV1",
      requiredDomains: ["defining_repo", "local_callers", "reflection_string_refs", "external_reference_corpus"],
    }

    const partialEvidence: CoverageEvidence[] = [
      {
        domain: "defining_repo",
        inspectedPaths: ["src/crypto/provider.ts"],
        method: "ast_search",
        callersFound: [],
        timestamp: Date.now(),
        evidenceId: "ev_def",
      },
      {
        domain: "local_callers",
        inspectedPaths: ["src/services/"],
        method: "grep",
        callersFound: [],
        timestamp: Date.now(),
        evidenceId: "ev_local",
      },
    ]

    const result = evaluateDecisionCoverage(requirement, partialEvidence)
    expect(result.satisfied).toBe(false)
    expect(result.missingDomains).toContain("reflection_string_refs")
    expect(result.missingDomains).toContain("external_reference_corpus")
    expect(result.reason).toContain("Missing required source universe domains")
  })

  test("regression: Axion local tree has 0 client callers but NothingOS/JADX has reflective callers", () => {
    const requirement: DecisionRequirement = {
      decisionType: "exposed_api_removal",
      targetSymbol: "AxionDeviceSecurityService.authenticateWithCert",
      requiredDomains: [
        "defining_repo",
        "local_callers",
        "reflection_string_refs",
        "external_reference_corpus",
      ],
      justification: "Proposed deletion of unused auth endpoint",
    }

    const localOnlyEvidence: CoverageEvidence[] = [
      {
        domain: "defining_repo",
        inspectedPaths: ["axion/security/AxionDeviceSecurityService.java"],
        method: "ast_search",
        callersFound: [],
        timestamp: Date.now(),
        evidenceId: "ev_axion_def",
      },
      {
        domain: "local_callers",
        inspectedPaths: ["axion/apps/"],
        method: "grep",
        callersFound: [],
        timestamp: Date.now(),
        evidenceId: "ev_axion_local",
      },
    ]

    const initialEval = evaluateDecisionCoverage(requirement, localOnlyEvidence)
    expect(initialEval.satisfied).toBe(false)
    expect(initialEval.missingDomains).toContain("external_reference_corpus")
    expect(initialEval.missingDomains).toContain("reflection_string_refs")

    const completeEvidenceWithReflectiveCallers: CoverageEvidence[] = [
      ...localOnlyEvidence,
      {
        domain: "reflection_string_refs",
        inspectedPaths: ["nothingos/frameworks/base/"],
        method: "grep",
        callersFound: ["com.nothing.os.security.SecurityBridge#invoke('authenticateWithCert')"],
        timestamp: Date.now(),
        evidenceId: "ev_nothing_reflect",
      },
      {
        domain: "external_reference_corpus",
        inspectedPaths: ["jadx/decompiled/nothing_service.jar"],
        method: "decompile_inspection",
        callersFound: ["com.nothing.service.NothingSecurityManager#connectAxion"],
        timestamp: Date.now(),
        evidenceId: "ev_jadx",
      },
    ]

    const finalEval = evaluateDecisionCoverage(requirement, completeEvidenceWithReflectiveCallers)
    expect(finalEval.satisfied).toBe(false)
    expect(finalEval.missingDomains.length).toBe(0)
    expect(finalEval.blockingCallers.length).toBe(2)
    expect(finalEval.blockingCallers).toContain("com.nothing.os.security.SecurityBridge#invoke('authenticateWithCert')")
    expect(finalEval.reason).toContain("blocked by active callers")
  })

  test("approves decision when all required domains are covered and zero callers exist", () => {
    const requirement: DecisionRequirement = {
      decisionType: "exposed_api_removal",
      targetSymbol: "DeprecatedInternalHelper.unusedFn",
      requiredDomains: ["defining_repo", "local_callers", "tests"],
    }

    const fullCleanEvidence: CoverageEvidence[] = [
      {
        domain: "defining_repo",
        inspectedPaths: ["src/helper.ts"],
        method: "ast_search",
        callersFound: [],
        timestamp: Date.now(),
        evidenceId: "ev_def",
      },
      {
        domain: "local_callers",
        inspectedPaths: ["src/"],
        method: "grep",
        callersFound: [],
        timestamp: Date.now(),
        evidenceId: "ev_callers",
      },
      {
        domain: "tests",
        inspectedPaths: ["test/"],
        method: "grep",
        callersFound: [],
        timestamp: Date.now(),
        evidenceId: "ev_tests",
      },
    ]

    const result = evaluateDecisionCoverage(requirement, fullCleanEvidence)
    expect(result.satisfied).toBe(true)
    expect(result.missingDomains.length).toBe(0)
    expect(result.blockingCallers.length).toBe(0)
  })
})
