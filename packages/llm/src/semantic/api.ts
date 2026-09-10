import { Effect, Schema } from "effect"
import {
  BuildIntent,
  DesignDirection,
  ClassifierID,
  ComplexityLevel,
  DecisionValue,
  OwnerDescriptor,
  OwnerSelection,
  PermissionDecision,
  PlaybookSelection,
  RiskAssessment,
  RecoveryDecision,
  QualityReview,
  SemanticTaskKind,
  StructureNeed,
  ScopeLevel,
  SlopDetection,
  StackDetection,
  TaskAnalysis,
  TaskContext,
  VerificationIntent,
} from "./schemas"
import { ClassifierRunner, type ClassifierFailure, type ClassifierTimeout, type ClassifyOptions } from "./classifier"
import { type SemanticCache, hashContext, getDefaultCache, type CacheKey } from "./cache"
import type { LLMError } from "../schema"

// ── Built-in Classifier Definitions ─────────────────────────────────────────

const STACK_CLASSIFIER_ID = ClassifierID.make("semantic.stack")
const PLAYBOOK_CLASSIFIER_ID = ClassifierID.make("semantic.playbook")
const BUILD_INTENT_CLASSIFIER_ID = ClassifierID.make("semantic.build-intent")
const TASK_TYPE_CLASSIFIER_ID = ClassifierID.make("semantic.task-type")
const SCOPE_CLASSIFIER_ID = ClassifierID.make("semantic.scope")
const COMPLEXITY_CLASSIFIER_ID = ClassifierID.make("semantic.complexity")
const VERIFICATION_CLASSIFIER_ID = ClassifierID.make("semantic.verification")
const PERMISSION_CLASSIFIER_ID = ClassifierID.make("semantic.permission")
const OWNER_CLASSIFIER_ID = ClassifierID.make("semantic.owner")
const RISK_CLASSIFIER_ID = ClassifierID.make("semantic.risk")
const TASK_ANALYSIS_CLASSIFIER_ID = ClassifierID.make("semantic.task-analysis")
const TASK_KIND_CLASSIFIER_ID = ClassifierID.make("semantic.task-kind")
const STRUCTURE_NEED_CLASSIFIER_ID = ClassifierID.make("semantic.structure-need")
const RECOVERY_CLASSIFIER_ID = ClassifierID.make("semantic.recovery")
const QUALITY_REVIEW_CLASSIFIER_ID = ClassifierID.make("semantic.quality-review")
const DESIGN_DIRECTION_CLASSIFIER_ID = ClassifierID.make("semantic.design-direction")

// ── Prompts ─────────────────────────────────────────────────────────────────

const STACK_PROMPT = `You are a stack detection classifier. Given a task description and repository facts, determine the relevant technology stack.

Return a JSON object with:
- languages: array of relevant programming languages
- frameworks: array of relevant frameworks
- platforms: array of relevant platforms (e.g., "android", "ios", "web", "node")
- buildSystems: array of relevant build systems
- repositoryType: optional string (e.g., "monorepo", "single-package")
- relevantModules: optional array of relevant module paths
- confidence: number between 0 and 1
- reason: optional explanation

Focus on the TASK-RELEVANT stack. Do not dump every technology in a monorepo.`

const PLAYBOOK_PROMPT = `You are a playbook classifier. Given a task description, determine which playbooks apply.

Return a JSON object with:
- primary: the main playbook name or null
- secondary: array of additional applicable playbooks
- confidence: number between 0 and 1
- reason: optional explanation

Available playbooks: implementation, bug_fix, debugging, investigation, refactor, code_cleanup, code_review, architecture, ui_ux, testing, build, performance, security, documentation, migration, dependency_update, repository_exploration`

const BUILD_INTENT_PROMPT = `You are a build intent classifier. Given a user request, determine the build-related intent.

CRITICAL RULES:
- "Do not build this" means executionProhibited=true, NOT executionAuthorized=true
- "Make sure this compiles" means validationRequested=true
- Build context relevance != execution request != execution authorization

Return a JSON object with:
- buildContextRelevant: whether the task involves build-related work
- validationRequested: whether the user wants to verify compilation/build
- executionRequested: whether the user wants to run a build
- executionAuthorized: whether the user explicitly authorized build execution
- executionProhibited: whether the user explicitly prohibited build execution
- buildSystems: array of detected build systems
- confidence: number between 0 and 1
- reason: optional explanation`

const SCOPE_PROMPT = `You are a scope classifier. Given a task description and affected files, determine the task scope.

Return a JSON string value: "local", "file", "component", "subsystem", "repository", "cross_repository", or "unknown"`

const COMPLEXITY_PROMPT = `You are a complexity classifier. Given a task description, determine the task complexity.

Return a JSON string value: "trivial", "low", "medium", "high", "systemic", or "unknown"`

const VERIFICATION_PROMPT = `You are a verification intent classifier. Given a task description, determine what verification the user wants.

Return a JSON object with:
- requested: whether verification is requested
- methods: array of verification methods from: static_analysis, lint, format, typecheck, unit_test, integration_test, build, runtime_test, manual_review
- confidence: number between 0 and 1
- reason: optional explanation`

const TASK_ANALYSIS_PROMPT = `You are a task analysis classifier. Given a task description and context, provide a comprehensive analysis.

Return a JSON object with:
- taskTypes: array of task type labels
- scope: one of "local", "file", "component", "subsystem", "repository", "cross_repository", "unknown"
- complexity: one of "trivial", "low", "medium", "high", "systemic", "unknown"
- stack: { languages, frameworks, platforms, buildSystems, confidence, reason }
- playbooks: { primary, secondary, confidence, reason }
- verification: { requested, methods, confidence, reason }
- build: { buildContextRelevant, validationRequested, executionRequested, executionAuthorized, executionProhibited, buildSystems, confidence, reason }
- risk: optional { level: "safe"|"low"|"moderate"|"high"|"destructive"|"unknown", reasons: string[] }`

const TASK_KIND_PROMPT = `Classify the primary kind of work the user is asking OCX to perform.

Return one JSON string value: "coding", "research", "git", "automation", "design", "review", "mixed", "general", or "unknown".
Use "mixed" when multiple work kinds are materially required. Do not assume repository work is coding.`

const STRUCTURE_NEED_PROMPT = `Decide whether this task benefits from the optional structure/architecture playbook before execution.

Structure is useful for architecture changes, broad refactors, migrations, multi-module greenfield systems, responsibility boundaries, or dependency topology changes.
Structure is usually unnecessary for isolated bug fixes, small edits, single-page demos, routine research, ordinary git operations, documentation, or simple automation.

Return JSON with:
- needed: boolean
- confidence: number from 0 to 1
- reasons: short array of task-specific reasons

Do not require structure merely because code or UI is involved.`

const RECOVERY_PROMPT = `Choose the next semantic recovery action after a failed tool/action attempt.

Respect the failure evidence and user restrictions. Never suggest retrying the same blocked semantic operation through another execution surface. If the failure is a scope/permission/policy block, prefer an allowed in-scope action or stop/ask when no legal action exists.

Return JSON with:
- actionClass: "retry_corrected" | "alternate_tool" | "inspect" | "ask_user" | "stop" | "unknown"
- shouldRetry: boolean
- correctedAction: optional concise next action
- preserveIntent: optional concise statement of the original user intent to preserve
- reason: optional explanation
- confidence: number from 0 to 1`

const QUALITY_REVIEW_PROMPT = `Review the supplied output or change for engineering quality.

Use repository/task context. Judge fit, not generic style preferences. Check architecture only when the scope warrants it; API fit against nearby conventions; naming clarity; unnecessary duplication/abstraction; error handling; maintainability; performance risks; and UI/design quality when relevant.
Do not demand refactors merely to make code smaller. Do not treat common names as bad without context. Do not recommend patterns solely because they are fashionable.

Return JSON with:
- verdict: "pass" | "review" | "block"
- concerns: array of { category, severity, evidence, recommendation, confidence }
- strengths: optional array of concrete strengths
- confidence: 0..1`

const DESIGN_DIRECTION_PROMPT = `Create a design direction for the requested UI from product purpose, audience, platform, constraints, and available repository context.

Do not default to a generic SaaS/AI landing-page style. Do not choose glassmorphism, gradients, rounded cards, giant hero copy, or sparse whitespace unless they fit the product. Prefer traits borrowed from strong human-made products/design systems that match the interaction model, without copying branding.

Return JSON with:
- productType
- audience
- primaryTask
- density: low | medium | medium-high | high
- visualCharacter: concise traits
- layoutStrategy: concrete composition rules
- typographyRoles: role-based typography direction, not just font names
- surfaceStrategy: how borders/surfaces/elevation communicate hierarchy
- motionPurpose: only purposeful motion
- referenceTraits: human-design traits worth borrowing
- antiPatterns: task-specific visual patterns to avoid
- confidence: 0..1`

// ── API Functions ───────────────────────────────────────────────────────────

export interface SemanticApiDeps {
  readonly runner?: ClassifierRunner
  readonly cache?: SemanticCache
}

function getRunner(deps?: SemanticApiDeps): ClassifierRunner {
  return deps?.runner ?? ClassifierRunner.make()
}

function getCache(deps?: SemanticApiDeps): SemanticCache {
  return deps?.cache ?? getDefaultCache()
}

function makeCacheKey(
  classifierId: string,
  version: number,
  context: TaskContext,
  modelClass?: string,
): CacheKey {
  return {
    classifierId,
    classifierVersion: version,
    contextHash: hashContext(context),
    modelClass,
  }
}

/** Generate a contextual visual direction before UI implementation. */
export function generateDesignDirection(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<DesignDirection, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  return runner.classify(
    {
      id: DESIGN_DIRECTION_CLASSIFIER_ID,
      version: 1,
      description: "Generate contextual UI design direction",
      outputSchema: Schema.Unknown,
      prompt: DESIGN_DIRECTION_PROMPT,
      modelClass: "standard",
    },
    context,
    DesignDirection,
    options,
  )
}

/** Run a semantic quality review for code, API, pipeline, or UI output. */
export function reviewOutputQuality(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<QualityReview, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  return runner.classify(
    {
      id: QUALITY_REVIEW_CLASSIFIER_ID,
      version: 1,
      description: "Review output quality using task and repository context",
      outputSchema: Schema.Unknown,
      prompt: QUALITY_REVIEW_PROMPT,
      modelClass: "standard",
    },
    context,
    QualityReview,
    options,
  )
}

/** Classify the work kind without assuming the task is coding. */
export function detectTaskKind(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<SemanticTaskKind, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  return runner.classify(
    {
      id: TASK_KIND_CLASSIFIER_ID,
      version: 1,
      description: "Classify the primary OCX work kind",
      outputSchema: Schema.Unknown,
      prompt: TASK_KIND_PROMPT,
      modelClass: "fast",
    },
    context,
    SemanticTaskKind,
    options,
  )
}

/** Decide whether the optional structure playbook is useful for this task. */
export function detectStructureNeed(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<StructureNeed, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  return runner.classify(
    {
      id: STRUCTURE_NEED_CLASSIFIER_ID,
      version: 1,
      description: "Decide whether structure/architecture guidance is needed",
      outputSchema: Schema.Unknown,
      prompt: STRUCTURE_NEED_PROMPT,
      modelClass: "fast",
    },
    context,
    StructureNeed,
    options,
  )
}

/** Choose a corrected next action from structured failure evidence. */
export function chooseRecoveryAction(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<RecoveryDecision, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  return runner.classify(
    {
      id: RECOVERY_CLASSIFIER_ID,
      version: 1,
      description: "Choose the next recovery action after a failed operation",
      outputSchema: Schema.Unknown,
      prompt: RECOVERY_PROMPT,
      modelClass: "fast",
    },
    context,
    RecoveryDecision,
    options,
  )
}

/**
 * Detect the relevant technology stack for a task.
 */
export function detectStack(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<StackDetection, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  const cache = getCache(options)

  const cacheKey = makeCacheKey(STACK_CLASSIFIER_ID, 1, context, options?.model ? undefined : "fast")

  return Effect.gen(function* () {
    const cached = yield* cache.get<StackDetection>(cacheKey)
    if (cached !== undefined) return cached

    const result = yield* runner.classify(
      {
        id: STACK_CLASSIFIER_ID,
        version: 1,
        description: "Detect task-relevant technology stack",
        outputSchema: Schema.Unknown,
        prompt: STACK_PROMPT,
        modelClass: "fast",
      },
      context,
      StackDetection,
      options,
    )

    yield* cache.set(cacheKey, result)
    return result
  })
}

/**
 * Detect which playbooks apply to a task.
 */
export function detectPlaybooks(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<PlaybookSelection, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  const cache = getCache(options)

  const cacheKey = makeCacheKey(PLAYBOOK_CLASSIFIER_ID, 1, context, options?.model ? undefined : "fast")

  return Effect.gen(function* () {
    const cached = yield* cache.get<PlaybookSelection>(cacheKey)
    if (cached !== undefined) return cached

    const result = yield* runner.classify(
      {
        id: PLAYBOOK_CLASSIFIER_ID,
        version: 1,
        description: "Detect applicable playbooks",
        outputSchema: Schema.Unknown,
        prompt: PLAYBOOK_PROMPT,
        modelClass: "fast",
      },
      context,
      PlaybookSelection,
      options,
    )

    yield* cache.set(cacheKey, result)
    return result
  })
}

/**
 * Detect build intent from a user request.
 */
export function detectBuildIntent(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<BuildIntent, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  const cache = getCache(options)

  const cacheKey = makeCacheKey(BUILD_INTENT_CLASSIFIER_ID, 1, context, options?.model ? undefined : "fast")

  return Effect.gen(function* () {
    const cached = yield* cache.get<BuildIntent>(cacheKey)
    if (cached !== undefined) return cached

    const result = yield* runner.classify(
      {
        id: BUILD_INTENT_CLASSIFIER_ID,
        version: 1,
        description: "Detect build intent from user request",
        outputSchema: Schema.Unknown,
        prompt: BUILD_INTENT_PROMPT,
        modelClass: "fast",
      },
      context,
      BuildIntent,
      options,
    )

    yield* cache.set(cacheKey, result)
    return result
  })
}

/**
 * Detect the scope of a task.
 */
export function detectScope(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<ScopeLevel, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)

  return Effect.gen(function* () {
    const result = yield* runner.classify(
      {
        id: SCOPE_CLASSIFIER_ID,
        version: 1,
        description: "Detect task scope",
        outputSchema: Schema.Unknown,
        prompt: SCOPE_PROMPT,
        modelClass: "fast",
      },
      context,
      ScopeLevel,
      options,
    )

    return result
  })
}

/**
 * Detect the complexity of a task.
 */
export function detectComplexity(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<ComplexityLevel, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)

  return Effect.gen(function* () {
    const result = yield* runner.classify(
      {
        id: COMPLEXITY_CLASSIFIER_ID,
        version: 1,
        description: "Detect task complexity",
        outputSchema: Schema.Unknown,
        prompt: COMPLEXITY_PROMPT,
        modelClass: "fast",
      },
      context,
      ComplexityLevel,
      options,
    )

    return result
  })
}

/**
 * Detect verification intent.
 */
export function detectVerification(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<VerificationIntent, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  const cache = getCache(options)

  const cacheKey = makeCacheKey(VERIFICATION_CLASSIFIER_ID, 1, context, options?.model ? undefined : "fast")

  return Effect.gen(function* () {
    const cached = yield* cache.get<VerificationIntent>(cacheKey)
    if (cached !== undefined) return cached

    const result = yield* runner.classify(
      {
        id: VERIFICATION_CLASSIFIER_ID,
        version: 1,
        description: "Detect verification intent",
        outputSchema: Schema.Unknown,
        prompt: VERIFICATION_PROMPT,
        modelClass: "fast",
      },
      context,
      VerificationIntent,
      options,
    )

    yield* cache.set(cacheKey, result)
    return result
  })
}

/**
 * Analyze a task comprehensively. Returns a composite TaskAnalysis.
 * Prefer this over calling multiple narrow classifiers.
 */
export function analyzeTask(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<TaskAnalysis, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)
  const cache = getCache(options)

  const cacheKey = makeCacheKey(TASK_ANALYSIS_CLASSIFIER_ID, 1, context, options?.model ? undefined : "standard")

  return Effect.gen(function* () {
    const cached = yield* cache.get<TaskAnalysis>(cacheKey)
    if (cached !== undefined) return cached

    const result = yield* runner.classify(
      {
        id: TASK_ANALYSIS_CLASSIFIER_ID,
        version: 1,
        description: "Comprehensive task analysis",
        outputSchema: Schema.Unknown,
        prompt: TASK_ANALYSIS_PROMPT,
        modelClass: "standard",
      },
      context,
      TaskAnalysis,
      options,
    )

    yield* cache.set(cacheKey, result)
    return result
  })
}

/**
 * Select the best owner for a task.
 */
export function selectOwner(
  context: TaskContext,
  owners: ReadonlyArray<OwnerDescriptor>,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<OwnerSelection, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)

  const ownerList = owners.map((o) => `${o.id}${o.name ? ` (${o.name})` : ""}: ${o.domains.join(", ")}${o.description ? ` - ${o.description}` : ""}`).join("\n")

  return Effect.gen(function* () {
    const result = yield* runner.classify(
      {
        id: OWNER_CLASSIFIER_ID,
        version: 1,
        description: "Select the best owner for a task",
        outputSchema: Schema.Unknown,
        prompt: `You are an owner selection classifier. Given a task and a list of owners, select the best match.

Available owners:
${ownerList}

Return a JSON object with:
- ownerId: the selected owner id, or null if no match
- createNewOwner: whether a new owner should be created
- ownershipDomain: the domain this task belongs to
- confidence: number between 0 and 1
- reason: optional explanation`,
        modelClass: "standard",
      },
      context,
      OwnerSelection,
      options,
    )

    return result
  })
}

/**
 * Assess the risk of a task.
 */
export function detectRisk(
  context: TaskContext,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<RiskAssessment, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)

  return Effect.gen(function* () {
    const result = yield* runner.classify(
      {
        id: RISK_CLASSIFIER_ID,
        version: 1,
        description: "Assess task risk",
        outputSchema: Schema.Unknown,
        prompt: `You are a risk assessment classifier. Given a task description, assess the risk level.

Return a JSON object with:
- level: one of "safe", "low", "moderate", "high", "destructive", "unknown"
- reasons: array of risk factor strings`,
        modelClass: "standard",
      },
      context,
      RiskAssessment,
      options,
    )

    return result
  })
}

// ── Slop Detection ──────────────────────────────────────────────────────────

const SLOP_CLASSIFIER_ID = ClassifierID.make("semantic.slop-detection")

const SLOP_PROMPT = `You are a slop detection classifier. Analyze the provided text for AI-generated slop patterns.

Treat the category examples below as signals, not automatic violations. Require contextual evidence, repetition, density, or a mismatch with the user/repository style before reporting subjective design or naming concerns.

Check for these categories:
- engagement_bait: "would you like me to", "let me know if", "feel free to", "hope this helps", "don't hesitate to"
- filler_hedge: "it's important to note", "please keep in mind", "in today's fast-paced"
- hype_word: "seamless", "world-class", "cutting-edge", "state-of-the-art", "game-changer", "revolutionary", "breathtaking", "supercharge", "effortless", "blazing fast", "next-generation"
- prose_tell: "delve", "tapestry", "testament to", "it's not just"
- sycophancy: "great question", "certainly", "of course", "i apologize"
- self_cheer: standalone "good!", "great!", "excellent!", "perfect!", "awesome!", "nice!" or phrases like "great progress"
- fake_success: "your inquiry has been sent", "we will contact you within", "message sent successfully"
- placeholder_contact: fake phone numbers like "(555) 123-4567" or addresses like "123 Main Street"
- dead_link: href="#"
- hotlinked_image: URLs from images.unsplash.com, source.unsplash.com, images.pexels.com, cdn.pixabay.com, picsum.photos
- dead_image_service: source.unsplash.com (shut down)
- unverified_asset_claim: "these are all real/valid/working/verified unsplash/pexels/pixabay photos"
- default_font: an unexplained pile of generic display/body fonts or typography choices that do not fit the product context
- default_font_reflex: AI reflex pairing like Space Grotesk + Inter or Playfair Display + Inter without deliberate design rationale
- glassmorphism: backdrop-filter: blur used 3+ times
- emoji_abuse: 4+ emoji glyphs in prose
- bold_overload: 10+ bold spans
- decorative_gradient: repeated decorative gradients that substitute for hierarchy or clash with the design direction
- gradient_heading_text: linear-gradient or background-clip: text applied to headings and titles
- inline_onclick_link_bypass: dummy link handlers using inline onclick="...return false;" to disguise non-functional anchors
- bento_grid_trope: forcing a generic asymmetric bento grid without semantic content justification
- decorative_spinning_ring: 360-degree infinite spinning rings or non-purposeful rotating elements
- hover_bounce: translateY(-) or scale(1.03+) on hover
- heading_formula: 4+ centered h2 headings or 3+ kicker+heading pairs
- form_label_heading: form labels styled as display headlines (large font, decorative fonts)
- repeated_opener: 3+ paragraphs starting with the same word
- emdash_density: 3+ em dashes in 60+ words
- ocx_jargon: "contract loop", "evidence ledger", "repair round", "stage row", "pre-pass", "pull model", "verdict cascade"
- apology_loop: 3+ apologies in one response

Return a JSON object with:
- findings: array of { category, severity ("warning"|"blocker"), evidence (the matching text snippet), fix (brief suggestion), confidence (0-1) }
- overallSeverity: "warning" if any warnings, "blocker" if any blockers
- summary: brief one-line summary of findings
- confidence: overall confidence (0-1)

Be precise. Only report findings you are confident about. Do not hallucinate patterns that are not present.`

/**
 * Detect slop patterns in generated text.
 */
export function detectSlop(
  text: string,
  options?: ClassifyOptions & SemanticApiDeps,
): Effect.Effect<SlopDetection, ClassifierFailure | ClassifierTimeout | LLMError> {
  const runner = getRunner(options)

  const context = new TaskContext({
    request: `Analyze this text for AI slop patterns:\n\n${text.slice(0, 4000)}`,
  })

  return Effect.gen(function* () {
    const result = yield* runner.classify(
      {
        id: SLOP_CLASSIFIER_ID,
        version: 1,
        description: "Detect AI slop patterns in generated text",
        outputSchema: Schema.Unknown,
        prompt: SLOP_PROMPT,
        modelClass: "fast",
      },
      context,
      SlopDetection,
      options,
    )

    return result
  })
}
