import { createPolicy, isEstablishedTerm, type SlopPolicy } from "./policy"

export const IDENTIFIER_SIGNALS = [
  "length",
  "semantic-word-count",
  "sentence-shaped-predicate",
  "representation-leakage",
  "enclosing-context-repetition",
  "parameter-context-repetition",
  "temporal-clause",
  "invented-abbreviation",
] as const

export type IdentifierSignal = (typeof IDENTIFIER_SIGNALS)[number]

export type IdentifierContext = {
  readonly enclosingTerms?: readonly string[]
  readonly parameterTerms?: readonly string[]
  readonly establishedTerms?: readonly string[]
}

export type IdentifierAnalysis = {
  readonly identifier: string
  readonly tokens: readonly string[]
  readonly length: number
  readonly semanticWords: number
  readonly score: number
  readonly signals: readonly IdentifierSignal[]
  readonly sentenceShaped: boolean
  readonly representationLeakage: boolean
  readonly repeatedEnclosingContext: boolean
  readonly repeatedParameterContext: boolean
  readonly inventedAbbreviation: boolean
  readonly exempted: boolean
  readonly requiresSemanticReview: boolean
  readonly action: "allow" | "review" | "strong-review" | "reject"
}

export type IdentifierFinding = {
  readonly rule: "N-semantic-compression"
  readonly severity: "warning"
  readonly identifier: string
  readonly line: number
  readonly analysis: IdentifierAnalysis
  readonly evidence: string
  readonly fix: string
}

const SENTENCE_WORDS = new Set([
  "already",
  "attempt",
  "carries",
  "can",
  "contains",
  "currently",
  "does",
  "has",
  "immediately",
  "is",
  "needs",
  "requires",
  "should",
  "when",
])
const TEMPORAL_WORDS = new Set(["after", "already", "before", "currently", "immediately", "once", "until", "when"])

export function analyze(
  identifier: string,
  context: IdentifierContext = {},
  policyInput?: SlopPolicy,
): IdentifierAnalysis {
  const policy = createPolicy(policyInput)
  const tokens = tokenize(identifier)
  const exempted = isEstablishedTerm(identifier, policy, context.establishedTerms)
  if (exempted || tokens.length === 0) return emptyAnalysis(identifier, tokens, exempted)

  const sentenceShaped = policy.identifier.detectSentencePredicates && isSentenceShaped(tokens)
  const representationLeakage =
    policy.identifier.detectRepresentationLeakage && tokens.some((token) => policy.identifier.representationWords.includes(token))
  const repeatedEnclosingContext =
    policy.identifier.detectEnclosingContextRepetition && repeatsContext(tokens, context.enclosingTerms)
  const repeatedParameterContext =
    policy.identifier.detectParameterContextRepetition && repeatsContext(tokens, context.parameterTerms)
  const inventedAbbreviation =
    policy.identifier.detectInventedAbbreviations && looksInvented(tokens, identifier, policy.identifier.conventionalAbbreviations)
  const temporalClause = tokens.some((token) => TEMPORAL_WORDS.has(token))
  const signals: IdentifierSignal[] = []
  let score = 0

  if (identifier.length > policy.identifier.advisoryLength) {
    signals.push("length")
    score += 1
  }
  if (identifier.length > policy.identifier.strongLength) score += 2
  if (tokens.length >= policy.identifier.strongSemanticWords) {
    signals.push("semantic-word-count")
    score += 3
  } else if (tokens.length >= policy.identifier.advisorySemanticWords) {
    signals.push("semantic-word-count")
    score += 2
  }
  if (sentenceShaped) {
    signals.push("sentence-shaped-predicate")
    score += 2
  }
  if (representationLeakage) {
    signals.push("representation-leakage")
    score += 1
  }
  if (repeatedEnclosingContext) {
    signals.push("enclosing-context-repetition")
    score += 2
  }
  if (repeatedParameterContext) {
    signals.push("parameter-context-repetition")
    score += 1
  }
  if (temporalClause && tokens.length >= 5) {
    signals.push("temporal-clause")
    score += 1
  }
  if (inventedAbbreviation) {
    signals.push("invented-abbreviation")
    score += 2
  }

  const requiresSemanticReview = score >= 3
  return {
    identifier,
    tokens,
    length: identifier.length,
    semanticWords: tokens.length,
    score,
    signals,
    sentenceShaped,
    representationLeakage,
    repeatedEnclosingContext,
    repeatedParameterContext,
    inventedAbbreviation,
    exempted: false,
    requiresSemanticReview,
    action: score >= 7 ? "reject" : score >= 4 ? "strong-review" : score >= 3 ? "review" : "allow",
  }
}

export function tokenize(identifier: string): string[] {
  return identifier
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[\s_\-]+/g, " ")
    .split(" ")
    .map((token) => token.trim().toLocaleLowerCase())
    .filter(Boolean)
}

export function scanSource(
  content: string,
  filePath = "",
  context: IdentifierContext = {},
  policyInput?: SlopPolicy,
): readonly IdentifierFinding[] {
  const findings: IdentifierFinding[] = []
  let enclosingType: string | undefined
  for (const [index, line] of content.split("\n").entries()) {
    const trimmed = line.trim()
    if (isComment(trimmed)) continue
    const owner = line.match(/\b(?:class|interface|type)\s+([A-Za-z_$][\w$]*)/)
    if (owner) enclosingType = owner[1]
    const parameters = parameterNames(line)
    for (const identifier of declarationNames(line)) {
      const analysis = analyze(
        identifier,
        {
          ...context,
          ...(enclosingType ? { enclosingTerms: [enclosingType, ...(context.enclosingTerms ?? [])] } : {}),
          ...(parameters.length > 0 ? { parameterTerms: parameters } : {}),
        },
        policyInput,
      )
      if (analysis.signals.length === 0 || !analysis.requiresSemanticReview) continue
      findings.push({
        rule: "N-semantic-compression",
        severity: "warning",
        identifier,
        line: index + 1,
        analysis,
        evidence: `${filePath ? `${filePath}:` : ""}${index + 1}: ${identifier} has ${analysis.semanticWords} semantic words and signals ${analysis.signals.join(", ")}`,
        fix: "inspect the implementation, callers, and project vocabulary before choosing a domain name; do not abbreviate or synonym-replace it",
      })
    }
  }
  return findings
}

function declarationNames(line: string): string[] {
  const names = new Set<string>()
  const patterns = [
    /\b(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:boolean|bool|number|string|unknown|object|void|any)\s+([A-Za-z_$][\w$]*)\s*\(/g,
  ]
  for (const pattern of patterns) for (const match of line.matchAll(pattern)) if (match[1]) names.add(match[1])
  return [...names]
}

function parameterNames(line: string): string[] {
  const group = line.match(/\(([^)]*)\)/)?.[1]
  if (!group) return []
  return group.split(",").flatMap((item) => {
    const match = item.trim().match(/(?:^|\s)([A-Za-z_$][\w$]*)\s*(?::|=|$)/)
    return match?.[1] ? [match[1]] : []
  })
}

function repeatsContext(tokens: readonly string[], context: readonly string[] | undefined): boolean {
  if (!context || context.length === 0) return false
  const contextTokens = new Set(context.flatMap(tokenize).filter((token) => token.length > 2))
  return tokens.some((token) => contextTokens.has(token))
}

function isSentenceShaped(tokens: readonly string[]): boolean {
  return tokens.length >= 4 && tokens.some((token) => SENTENCE_WORDS.has(token))
}

function looksInvented(tokens: readonly string[], identifier: string, abbreviations: readonly string[]): boolean {
  if (!/[a-z][A-Z]/.test(identifier)) return false
  const allowed = new Set(abbreviations.map((item) => item.toLocaleLowerCase()))
  const short = tokens.filter((token) => token.length <= 3 && !allowed.has(token))
  const singleLetters = tokens.filter((token) => token.length === 1)
  return singleLetters.length >= 2 || (tokens.length >= 4 && short.length >= 3)
}

function isComment(line: string): boolean {
  return line.startsWith("//") || line.startsWith("/*") || line.startsWith("*") || line.startsWith("#")
}

function emptyAnalysis(identifier: string, tokens: readonly string[], exempted: boolean): IdentifierAnalysis {
  return {
    identifier,
    tokens,
    length: identifier.length,
    semanticWords: tokens.length,
    score: 0,
    signals: [],
    sentenceShaped: false,
    representationLeakage: false,
    repeatedEnclosingContext: false,
    repeatedParameterContext: false,
    inventedAbbreviation: false,
    exempted,
    requiresSemanticReview: false,
    action: "allow",
  }
}

export * as IdentifierShapeAnalyzer from "./identifier-shape"
