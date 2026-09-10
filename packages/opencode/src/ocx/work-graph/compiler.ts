import type { SemanticResult } from "../semantic-bridge"
import {
  type ArtifactKind,
  type Concern,
  type EffectKind,
  type Graph,
  type GraphPatch,
  type OperationKind,
  type WorkIntent,
  type WorkNode,
} from "./types"

type CompileInput = {
  readonly request: string
  readonly sessionID: string
  readonly repositoryID?: string
  readonly currentGraph?: Graph
  readonly semantic?: SemanticResult
  readonly intentRevision: number
  readonly now?: number
}

type Recipe = {
  readonly intent: WorkIntent
  readonly operation: OperationKind
  readonly artifact: ArtifactKind
  readonly effects: readonly EffectKind[]
  readonly concerns: readonly Concern[]
  readonly validator: string
}

const RECIPES: Partial<Record<WorkIntent, Recipe>> = {
  answer: {
    intent: "answer",
    operation: "answer",
    artifact: "external_information",
    effects: ["read_file", "search_repo", "search_web"],
    concerns: ["correctness"],
    validator: "response_claims",
  },
  explain: {
    intent: "explain",
    operation: "explain",
    artifact: "external_information",
    effects: ["read_file", "search_repo"],
    concerns: ["correctness", "maintainability"],
    validator: "source_fidelity",
  },
  explore: {
    intent: "explore",
    operation: "inspect",
    artifact: "source",
    effects: ["read_file", "search_repo"],
    concerns: ["correctness", "architecture"],
    validator: "context_observed",
  },
  research: {
    intent: "research",
    operation: "search",
    artifact: "external_information",
    effects: ["search_web", "read_file"],
    concerns: ["correctness", "compatibility"],
    validator: "source_quality",
  },
  diagnose: {
    intent: "diagnose",
    operation: "diagnose",
    artifact: "runtime",
    effects: ["read_file", "search_repo"],
    concerns: ["correctness", "reliability"],
    validator: "diagnosis_supported",
  },
  review: {
    intent: "review",
    operation: "review_code",
    artifact: "source",
    effects: ["read_file", "search_repo"],
    concerns: ["correctness", "maintainability", "security"],
    validator: "review_findings",
  },
  document: {
    intent: "document",
    operation: "review_documentation",
    artifact: "documentation",
    effects: ["read_file", "search_repo"],
    concerns: ["correctness", "maintainability"],
    validator: "source_fidelity",
  },
  plan: {
    intent: "plan",
    operation: "plan",
    artifact: "external_information",
    effects: ["read_file", "search_repo"],
    concerns: ["architecture", "maintainability"],
    validator: "plan_consistency",
  },
}

const SEMANTIC_INTENTS: Record<string, WorkIntent> = {
  research: "research",
  review: "review",
  design: "explain",
  git: "explore",
  general: "answer",
  mixed: "explore",
  unknown: "answer",
}

const DEFAULT_RETRY_POLICY = {
  maxActivities: 4,
  maxLLMCalls: 2,
  maxRetries: 1,
  maxEquivalentFailures: 2,
  maxReplans: 1,
} as const

export function compile(input: CompileInput): GraphPatch | undefined {
  const request = input.request.trim()
  if (!request || isAcknowledgement(request)) return undefined
  const recipe = recipeFor(request, input.semantic)
  const intentKey = intentKeyFor(request)
  const nodeID = `node_${hash(`${input.sessionID}\u0000${input.intentRevision}\u0000${intentKey}`)}`
  if (input.currentGraph?.intentKey === intentKey && input.currentGraph.nodes.some((node) => node.id === nodeID))
    return undefined
  const node: WorkNode = {
    id: nodeID,
    intent: [recipe.intent],
    operation: recipe.operation,
    goal: request,
    acceptance: [
      {
        id: `accept_${hash(`${nodeID}\u0000acceptance`)}`,
        description: acceptanceFor(recipe.intent),
        required: true,
      },
    ],
    artifacts: [{ kind: recipe.artifact, subject: request }],
    concerns: recipe.concerns,
    risk: { level: recipe.intent === "research" || recipe.intent === "answer" ? "safe" : "low", signals: [] },
    scope: {
      ...(input.repositoryID ? { root: input.repositoryID } : {}),
      paths: [],
      access: "read",
    },
    status: "pending",
    revision: 0,
    dependencies: [],
    effectPolicy: { effects: recipe.effects, approvals: [] },
    evidenceRequirements: [
      {
        id: `evidence_${hash(`${nodeID}\u0000${recipe.validator}`)}`,
        description: acceptanceFor(recipe.intent),
        predicate: recipe.validator,
        blocking: "node_completion",
        invalidatedBy: ["intent_revision", "relevant_mutation"],
        required: true,
      },
    ],
    validationPolicy: { validators: [recipe.validator], required: true },
    retryPolicy: DEFAULT_RETRY_POLICY,
    createdBy: "recipe",
    createdIntentRevision: input.intentRevision,
    updatedAt: input.now ?? Date.now(),
  }
  return {
    addNodes: [node],
    removeNodeIDs: [],
    supersedeNodeIDs: (input.currentGraph?.nodes ?? [])
      .filter((current) => !isTerminal(current.status) && current.id !== nodeID)
      .map((current) => current.id),
    addEdges: [],
    removeEdges: [],
    intentKey,
    intentRevision: input.intentRevision,
    reason: `compiled ${recipe.intent} inquiry recipe`,
  }
}

function recipeFor(request: string, semantic: SemanticResult | undefined): Recipe {
  const explicit = explicitIntent(request)
  if (explicit) return RECIPES[explicit]!
  const semanticIntent = semantic?.taskAnalysis?.taskTypes
    .map((item) => SEMANTIC_INTENTS[item.toLocaleLowerCase()])
    .find((item): item is WorkIntent => item !== undefined)
  if (semanticIntent) return RECIPES[semanticIntent]!
  return RECIPES.answer!
}

function explicitIntent(request: string): WorkIntent | undefined {
  const text = request.toLocaleLowerCase()
  if (/\b(?:review|audit|critique)\b/.test(text)) return "review"
  if (/\b(?:research|investigate|look\s+up|find\s+out|sources?)\b/.test(text)) return "research"
  if (/\b(?:document|documentation|docs?|readme|changelog)\b/.test(text)) return "document"
  if (/\b(?:explain|what\s+is|how\s+does|why\s+does|describe)\b/.test(text)) return "explain"
  if (/\b(?:debug|diagnos|broken|failure|failing|error|regression)\b/.test(text)) return "diagnose"
  if (/\b(?:plan|planning|outline|steps?)\b/.test(text)) return "plan"
  if (/\b(?:explore|inspect|understand|where\s+is|find\s+the)\b/.test(text)) return "explore"
  return undefined
}

function acceptanceFor(intent: WorkIntent): string {
  if (intent === "research") return "relevant claims are mapped to usable sources"
  if (intent === "review") return "findings are grounded in the requested scope"
  if (intent === "document") return "documentation claims are grounded in the source of truth"
  if (intent === "diagnose") return "the diagnosis is supported by observed evidence"
  if (intent === "explore") return "the requested repository context is observed"
  if (intent === "plan") return "the proposed work is internally consistent and scoped"
  if (intent === "explain") return "the explanation matches the relevant source or evidence"
  return "the user request is answered without unsupported claims"
}

function isAcknowledgement(request: string): boolean {
  return /^(?:ok(?:ay)?|thanks?|thank\s+you|got\s+it|understood|continue|resume|keep\s+going|carry\s+on|yes|no|done)\s*[.!]?$/i.test(
    request,
  )
}

function isTerminal(status: WorkNode["status"]): boolean {
  return status === "completed" || status === "superseded" || status === "cancelled"
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim()
}

export function intentKeyFor(request: string): string {
  return `intent_${hash(normalize(request))}`
}

function hash(value: string): string {
  let result = 2166136261
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

export * as WorkGraphCompiler from "./compiler"
