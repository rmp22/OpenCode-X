import type { RequestIntent, TaskKind } from "./types"

const BUG_FIX_SIGNALS = [
  /\bbug\b/i,
  /\bfix(?:ing|ed|es)?\b/i,
  /\bbroken\b/i,
  /\bcrash(?:ing|es)?\b/i,
  /\bfails?\b/i,
  /\berror\b/i,
  /\bexception\b/i,
  /\bdefect\b/i,
  /\bissue\b/i,
  /\bregression\b/i,
]

const CLEANUP_SIGNALS = [
  /\bclean(?:up|ing)?\b/i,
  /\bslop\b/i,
  /\bAI[-\s]?slop\b/i,
  /\brefactor\b/i,
  /\bnormalize\b/i,
  /\bnormalize[-\s]?/i,
  /\bconsolidate\b/i,
  /\bdeduplicate\b/i,
  /\bremove\s+(?:duplicate|redundant|unnecessary|unused)\b/i,
]

const HARDENING_SIGNALS = [
  /\bharden(?:ing)?\b/i,
  /\bhardening\b/i,
  /\bproduction[-\s]?ready\b/i,
  /\bproduction\s+ready\b/i,
  /\bedge\s+case\b/i,
  /\bsecurity\b/i,
  /\bvalidation\b/i,
  /\bdefensive\b/i,
]

const ARCHITECTURE_SIGNALS = [
  /\barchitecture\b/i,
  /\bstructural\b/i,
  /\bredesign\b/i,
  /\brestructure\b/i,
  /\brefactor\s+(?:the\s+)?architecture\b/i,
  /\bmodule\s+boundary\b/i,
  /\bAPI\s+redesign\b/i,
  /\bownership\b/i,
  /\bsource\s+of\s+truth\b/i,
]

const FEATURE_SIGNALS = [
  /\bfeature\b/i,
  /\bnew\s+(?:feature|capability|functionality)\b/i,
  /\badd(?:ing|ed|s)?\b/i,
  /\bimplement\b/i,
  /\bsupport\b/i,
]

const EXPLORATION_SIGNALS = [
  /\bexplore\b/i,
  /\binvestigate\b/i,
  /\bunderstand\b/i,
  /\bwhat\s+is\b/i,
  /\bhow\s+does\b/i,
  /\bwhy\s+does\b/i,
]

const MINIMAL_PATCH_SIGNALS = [
  /\bminimal\s+change\b/i,
  /\bsmallest\s+change\b/i,
  /\bminimal\s+patch\b/i,
  /\bsmallest\s+patch\b/i,
  /\bmake\s+it\s+small\b/i,
  /\bkeep\s+the\s+diff\s+minimal\b/i,
  /\btouch\s+as\s+little\b/i,
  /\btargeted\s+fix\b/i,
  /\bsurgical\b/i,
  /\bone[-\s]line\b/i,
]

const BREADTH_SIGNALS = {
  cleanup: CLEANUP_SIGNALS,
  hardening: HARDENING_SIGNALS,
  productionReadiness: HARDENING_SIGNALS,
  edgeCaseReview: HARDENING_SIGNALS,
  architecture: ARCHITECTURE_SIGNALS,
}

export type IntentAnalysis = {
  readonly taskKind: TaskKind[]
  readonly explicitScope: string | undefined
  readonly qualityBar: "minimal" | "standard" | "comprehensive" | "production"
  readonly minimalPatchRequested: boolean
  readonly preserveUnrelatedWip: boolean
  readonly broadCleanupRequested: boolean
  readonly hardeningRequested: boolean
  readonly productionReadinessRequested: boolean
  readonly edgeCaseReviewRequested: boolean
  readonly architectureRequested: boolean
}

function matchSignals(text: string, signals: readonly RegExp[]): boolean {
  return signals.some((signal) => signal.test(text))
}

function extractExplicitScope(text: string): string | undefined {
  const patterns = [
    /\b(?:scope|target|focus|area|component|module|subsystem|feature)\s*[:\-]\s*(.+)/i,
    /\b(?:in|for|on)\s+(?:the\s+)?(\w[\w\s]+?)(?:\s+module|\s+component|\s+feature|\s+subsystem|\s+area)?\s*$/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const scope = match[1].trim()
      if (scope.length > 2 && scope.length < 120) return scope
    }
  }
  return undefined
}

function extractQualityBar(text: string): "minimal" | "standard" | "comprehensive" | "production" {
  if (/\bproduction[-\s]?ready\b/i.test(text)) return "production"
  if (/\bcomprehensive\b/i.test(text)) return "comprehensive"
  if (/\bminimal\s+(?:change|patch|diff)\b/i.test(text)) return "minimal"
  return "standard"
}

export function analyzeIntent(text: string): IntentAnalysis {
  const taskKind: TaskKind[] = []

  if (matchSignals(text, BUG_FIX_SIGNALS)) taskKind.push("bug_fix")
  if (matchSignals(text, CLEANUP_SIGNALS)) taskKind.push("cleanup")
  if (matchSignals(text, HARDENING_SIGNALS)) taskKind.push("hardening")
  if (matchSignals(text, ARCHITECTURE_SIGNALS)) taskKind.push("architecture")
  if (matchSignals(text, FEATURE_SIGNALS)) taskKind.push("feature")
  if (matchSignals(text, EXPLORATION_SIGNALS)) taskKind.push("exploration")

  const aiSlopMatch = text.match(/\b(?:remove|clean)\s+(?:AI[-\s]?)?slop\b/i)
  if (aiSlopMatch) taskKind.push("ai_slop_removal")

  const minimalPatchRequested = matchSignals(text, MINIMAL_PATCH_SIGNALS)
  const broadCleanupRequested = matchSignals(text, CLEANUP_SIGNALS) && taskKind.includes("cleanup")
  const hardeningRequested = matchSignals(text, HARDENING_SIGNALS)
  const productionReadinessRequested = /\bproduction[-\s]?ready\b/i.test(text)
  const edgeCaseReviewRequested = /\bedge\s+case\b/i.test(text)
  const architectureRequested = matchSignals(text, ARCHITECTURE_SIGNALS)

  const preserveUnrelatedWip = /\b(?:preserve|keep|protect).*(?:unrelated|user|existing|current)/i.test(text)
    || /\bWIP\b/i.test(text)

  return {
    taskKind,
    explicitScope: extractExplicitScope(text),
    qualityBar: extractQualityBar(text),
    minimalPatchRequested,
    preserveUnrelatedWip,
    broadCleanupRequested,
    hardeningRequested,
    productionReadinessRequested,
    edgeCaseReviewRequested,
    architectureRequested,
  }
}

export * as RequestIntentAnalyzer from "./intent-analyzer"
