export type HighConsequenceDecisionType =
  | "exposed_api_removal"
  | "compatibility_contraction"
  | "dependency_removal"
  | "schema_contraction"
  | "negative_no_callers"
  | "parity_claim"

export type SourceUniverseDomain =
  | "defining_repo"
  | "local_callers"
  | "interface_generated"
  | "reflection_string_refs"
  | "jni_native"
  | "build_config"
  | "tests"
  | "plugins_extensions"
  | "external_reference_corpus"
  | "compatibility_consumers"

export type CoverageEvidence = {
  readonly domain: SourceUniverseDomain
  readonly inspectedPaths: readonly string[]
  readonly method: "ast_search" | "grep" | "decompile_inspection" | "symbol_index"
  readonly callersFound: readonly string[]
  readonly timestamp: number
  readonly evidenceId: string
}

export type DecisionRequirement = {
  readonly decisionType: HighConsequenceDecisionType
  readonly targetSymbol: string
  readonly requiredDomains: readonly SourceUniverseDomain[]
  readonly justification?: string
}

export type DecisionCoverageEvaluation = {
  readonly satisfied: boolean
  readonly missingDomains: readonly SourceUniverseDomain[]
  readonly blockingCallers: readonly string[]
  readonly coveredDomains: readonly SourceUniverseDomain[]
  readonly reason?: string
}

const DOMAINS_BY_DECISION_TYPE: Record<HighConsequenceDecisionType, readonly SourceUniverseDomain[]> = {
  exposed_api_removal: [
    "defining_repo",
    "local_callers",
    "interface_generated",
    "reflection_string_refs",
    "jni_native",
    "build_config",
    "tests",
    "plugins_extensions",
    "external_reference_corpus",
    "compatibility_consumers",
  ],
  negative_no_callers: [
    "defining_repo",
    "local_callers",
    "interface_generated",
    "reflection_string_refs",
    "jni_native",
    "build_config",
    "tests",
    "plugins_extensions",
    "external_reference_corpus",
    "compatibility_consumers",
  ],
  compatibility_contraction: [
    "defining_repo",
    "local_callers",
    "compatibility_consumers",
    "external_reference_corpus",
  ],
  dependency_removal: [
    "defining_repo",
    "local_callers",
    "build_config",
    "tests",
    "plugins_extensions",
  ],
  schema_contraction: [
    "defining_repo",
    "local_callers",
    "compatibility_consumers",
    "interface_generated",
  ],
  parity_claim: [
    "defining_repo",
    "local_callers",
    "tests",
    "compatibility_consumers",
  ],
}

export function defaultRequiredDomainsFor(
  decisionType: HighConsequenceDecisionType,
): readonly SourceUniverseDomain[] {
  const domains = DOMAINS_BY_DECISION_TYPE[decisionType]
  return domains
}

export function evaluateDecisionCoverage(
  requirement: DecisionRequirement,
  coverageList: readonly CoverageEvidence[],
): DecisionCoverageEvaluation {
  const coveredSet = new Set(coverageList.map((c) => c.domain))
  const missingDomains = requirement.requiredDomains.filter((d) => !coveredSet.has(d))

  const blockingCallers: string[] = []
  for (const item of coverageList) {
    if (item.callersFound && item.callersFound.length > 0) {
      blockingCallers.push(...item.callersFound)
    }
  }

  const coveredDomains = requirement.requiredDomains.filter((d) => coveredSet.has(d))

  if (missingDomains.length > 0) {
    const evalResult: DecisionCoverageEvaluation = {
      satisfied: false,
      missingDomains,
      blockingCallers,
      coveredDomains,
      reason: "Missing required source universe domains: " + missingDomains.join(", "),
    }
    return evalResult
  }

  if (blockingCallers.length > 0) {
    const evalResult: DecisionCoverageEvaluation = {
      satisfied: false,
      missingDomains,
      blockingCallers,
      coveredDomains,
      reason: "Decision blocked by active callers in covered domains: " + blockingCallers.join(", "),
    }
    return evalResult
  }

  const evalResult: DecisionCoverageEvaluation = {
    satisfied: true,
    missingDomains: [],
    blockingCallers: [],
    coveredDomains,
  }
  return evalResult
}

export * as DecisionCoverageModule from "./decision-coverage"
