export type IdentifierPolicy = {
  readonly advisoryLength: number
  readonly strongLength: number
  readonly advisorySemanticWords: number
  readonly strongSemanticWords: number
  readonly detectSentencePredicates: boolean
  readonly detectRepresentationLeakage: boolean
  readonly detectEnclosingContextRepetition: boolean
  readonly detectParameterContextRepetition: boolean
  readonly detectInventedAbbreviations: boolean
  readonly representationWords: readonly string[]
  readonly conventionalAbbreviations: readonly string[]
}

export type SlopPolicy = {
  readonly version: 1
  readonly enabled: boolean
  readonly identifier: IdentifierPolicy
  readonly genericActions: readonly string[]
  readonly genericRoles: readonly string[]
  readonly genericValues: readonly string[]
  readonly domainTerms: readonly string[]
  readonly protocolTerms: readonly string[]
  readonly upstreamTerms: readonly string[]
  readonly publicTerms: readonly string[]
}

export type SlopPolicyInput = {
  readonly enabled?: boolean
  readonly identifier?: Partial<IdentifierPolicy>
  readonly genericActions?: readonly string[]
  readonly genericRoles?: readonly string[]
  readonly genericValues?: readonly string[]
  readonly domainTerms?: readonly string[]
  readonly protocolTerms?: readonly string[]
  readonly upstreamTerms?: readonly string[]
  readonly publicTerms?: readonly string[]
}

const DEFAULT_IDENTIFIER_POLICY: IdentifierPolicy = {
  advisoryLength: 35,
  strongLength: 48,
  advisorySemanticWords: 5,
  strongSemanticWords: 6,
  detectSentencePredicates: true,
  detectRepresentationLeakage: true,
  detectEnclosingContextRepetition: true,
  detectParameterContextRepetition: true,
  detectInventedAbbreviations: true,
  representationWords: ["mask", "flag", "bit", "map", "array", "list", "bundle"],
  conventionalAbbreviations: ["api", "cpu", "fd", "gpu", "http", "ipc", "pid", "uid", "uri", "url"],
}

export const DEFAULT_POLICY: SlopPolicy = {
  version: 1,
  enabled: true,
  identifier: DEFAULT_IDENTIFIER_POLICY,
  genericActions: ["do", "handle", "process", "manage", "trigger", "kick", "poke", "nudge"],
  genericRoles: ["manager", "helper", "util", "processor", "handler"],
  genericValues: ["data", "info", "thing", "stuff", "temp", "result", "value"],
  domainTerms: [],
  protocolTerms: [],
  upstreamTerms: [],
  publicTerms: [],
}

export function createPolicy(input: SlopPolicyInput = {}): SlopPolicy {
  const identifier = input.identifier ?? {}
  return {
    version: 1,
    enabled: input.enabled ?? DEFAULT_POLICY.enabled,
    identifier: {
      advisoryLength: positive(identifier.advisoryLength, DEFAULT_IDENTIFIER_POLICY.advisoryLength),
      strongLength: positive(identifier.strongLength, DEFAULT_IDENTIFIER_POLICY.strongLength),
      advisorySemanticWords: positive(identifier.advisorySemanticWords, DEFAULT_IDENTIFIER_POLICY.advisorySemanticWords),
      strongSemanticWords: positive(identifier.strongSemanticWords, DEFAULT_IDENTIFIER_POLICY.strongSemanticWords),
      detectSentencePredicates: identifier.detectSentencePredicates ?? DEFAULT_IDENTIFIER_POLICY.detectSentencePredicates,
      detectRepresentationLeakage:
        identifier.detectRepresentationLeakage ?? DEFAULT_IDENTIFIER_POLICY.detectRepresentationLeakage,
      detectEnclosingContextRepetition:
        identifier.detectEnclosingContextRepetition ?? DEFAULT_IDENTIFIER_POLICY.detectEnclosingContextRepetition,
      detectParameterContextRepetition:
        identifier.detectParameterContextRepetition ?? DEFAULT_IDENTIFIER_POLICY.detectParameterContextRepetition,
      detectInventedAbbreviations:
        identifier.detectInventedAbbreviations ?? DEFAULT_IDENTIFIER_POLICY.detectInventedAbbreviations,
      representationWords: terms(identifier.representationWords, DEFAULT_IDENTIFIER_POLICY.representationWords),
      conventionalAbbreviations: terms(
        identifier.conventionalAbbreviations,
        DEFAULT_IDENTIFIER_POLICY.conventionalAbbreviations,
      ),
    },
    genericActions: terms(input.genericActions, DEFAULT_POLICY.genericActions),
    genericRoles: terms(input.genericRoles, DEFAULT_POLICY.genericRoles),
    genericValues: terms(input.genericValues, DEFAULT_POLICY.genericValues),
    domainTerms: terms(input.domainTerms, DEFAULT_POLICY.domainTerms),
    protocolTerms: terms(input.protocolTerms, DEFAULT_POLICY.protocolTerms),
    upstreamTerms: terms(input.upstreamTerms, DEFAULT_POLICY.upstreamTerms),
    publicTerms: terms(input.publicTerms, DEFAULT_POLICY.publicTerms),
  }
}

export function parsePolicy(value: unknown): SlopPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const rawIdentifier = record.identifier ?? record.identifier_shape
  const identifier = rawIdentifier && typeof rawIdentifier === "object" && !Array.isArray(rawIdentifier)
    ? (rawIdentifier as Record<string, unknown>)
    : {}
  return createPolicy({
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    identifier: {
      advisoryLength: number(identifier.advisoryLength ?? identifier.advisory_length),
      strongLength: number(identifier.strongLength ?? identifier.strong_length),
      advisorySemanticWords: number(identifier.advisorySemanticWords ?? identifier.advisory_semantic_words),
      strongSemanticWords: number(identifier.strongSemanticWords ?? identifier.strong_semantic_words),
      detectSentencePredicates: boolean(identifier.detectSentencePredicates ?? identifier.detect_sentence_predicates),
      detectRepresentationLeakage: boolean(
        identifier.detectRepresentationLeakage ?? identifier.detect_representation_leakage,
      ),
      detectEnclosingContextRepetition: boolean(
        identifier.detectEnclosingContextRepetition ?? identifier.detect_enclosing_context_repetition,
      ),
      detectParameterContextRepetition: boolean(
        identifier.detectParameterContextRepetition ?? identifier.detect_parameter_context_repetition,
      ),
      detectInventedAbbreviations: boolean(
        identifier.detectInventedAbbreviations ?? identifier.detect_invented_abbreviations,
      ),
      representationWords: list(identifier.representationWords ?? identifier.representation_words),
      conventionalAbbreviations: list(identifier.conventionalAbbreviations ?? identifier.conventional_abbreviations),
    },
    genericActions: list(record.genericActions ?? record.generic_actions),
    genericRoles: list(record.genericRoles ?? record.generic_roles),
    genericValues: list(record.genericValues ?? record.generic_values),
    domainTerms: list(record.domainTerms ?? record.domain_terms),
    protocolTerms: list(record.protocolTerms ?? record.protocol_terms),
    upstreamTerms: list(record.upstreamTerms ?? record.upstream_terms),
    publicTerms: list(record.publicTerms ?? record.public_terms),
  })
}

export function isEstablishedTerm(
  value: string,
  policy: SlopPolicy = DEFAULT_POLICY,
  extraTerms: readonly string[] = [],
): boolean {
  const normalized = termKey(value)
  if (!normalized) return false
  return [...policy.domainTerms, ...policy.protocolTerms, ...policy.upstreamTerms, ...policy.publicTerms, ...extraTerms]
    .some((term) => termKey(term) === normalized)
}

export function termKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function terms(value: readonly string[] | undefined, fallback: readonly string[]): string[] {
  if (!value) return [...fallback]
  return [
    ...new Set(
      value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 120 && !item.includes("===")),
    ),
  ]
}

function list(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export * as SlopPolicy from "./policy"
