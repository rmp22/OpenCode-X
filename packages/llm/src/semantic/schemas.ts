import { Schema } from "effect"

// ── Decision ────────────────────────────────────────────────────────────────

export const DecisionValue = Schema.Literals(["yes", "no", "unknown", "ambiguous", "not_applicable"])
export type DecisionValue = Schema.Schema.Type<typeof DecisionValue>

export class Decision extends Schema.Class<Decision>("Semantic.Decision")({
  decision: DecisionValue,
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.Array(Schema.String)),
}) {}

// ── StackDetection ──────────────────────────────────────────────────────────

export class StackDetection extends Schema.Class<StackDetection>("Semantic.StackDetection")({
  languages: Schema.Array(Schema.String),
  frameworks: Schema.Array(Schema.String),
  platforms: Schema.Array(Schema.String),
  buildSystems: Schema.Array(Schema.String),
  repositoryType: Schema.optional(Schema.String),
  relevantModules: Schema.optional(Schema.Array(Schema.String)),
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
}) {}

// ── PlaybookSelection ───────────────────────────────────────────────────────

export class PlaybookSelection extends Schema.Class<PlaybookSelection>("Semantic.PlaybookSelection")({
  primary: Schema.NullOr(Schema.String),
  secondary: Schema.Array(Schema.String),
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
}) {}

// ── BuildIntent ─────────────────────────────────────────────────────────────

export class BuildIntent extends Schema.Class<BuildIntent>("Semantic.BuildIntent")({
  buildContextRelevant: Schema.Boolean,
  validationRequested: Schema.Boolean,
  executionRequested: Schema.Boolean,
  executionAuthorized: Schema.Boolean,
  executionProhibited: Schema.Boolean,
  buildSystems: Schema.Array(Schema.String),
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
}) {}

// ── VerificationIntent ──────────────────────────────────────────────────────

export const VerificationMethod = Schema.Literals([
  "static_analysis",
  "lint",
  "format",
  "typecheck",
  "unit_test",
  "integration_test",
  "build",
  "runtime_test",
  "manual_review",
])
export type VerificationMethod = Schema.Schema.Type<typeof VerificationMethod>

export class VerificationIntent extends Schema.Class<VerificationIntent>("Semantic.VerificationIntent")({
  requested: Schema.Boolean,
  methods: Schema.Array(VerificationMethod),
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
}) {}

// ── PermissionDecision ──────────────────────────────────────────────────────

export class PermissionDecision extends Schema.Class<PermissionDecision>("Semantic.PermissionDecision")({
  action: Schema.String,
  decision: Schema.Literals(["authorized", "not_authorized", "prohibited", "ambiguous", "unknown"]),
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
}) {}

// ── OwnerSelection ──────────────────────────────────────────────────────────

export class OwnerDescriptor extends Schema.Class<OwnerDescriptor>("Semantic.OwnerDescriptor")({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  domains: Schema.Array(Schema.String),
  description: Schema.optional(Schema.String),
}) {}

export class OwnerSelection extends Schema.Class<OwnerSelection>("Semantic.OwnerSelection")({
  ownerId: Schema.optional(Schema.String),
  createNewOwner: Schema.Boolean,
  ownershipDomain: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
}) {}

// ── RiskAssessment ──────────────────────────────────────────────────────────

export class RiskAssessment extends Schema.Class<RiskAssessment>("Semantic.RiskAssessment")({
  level: Schema.Literals(["safe", "low", "moderate", "high", "destructive", "unknown"]),
  reasons: Schema.Array(Schema.String),
}) {}

// ── Scope ───────────────────────────────────────────────────────────────────

export const ScopeLevel = Schema.Literals([
  "local",
  "file",
  "component",
  "subsystem",
  "repository",
  "cross_repository",
  "unknown",
])
export type ScopeLevel = Schema.Schema.Type<typeof ScopeLevel>

// ── Complexity ──────────────────────────────────────────────────────────────

export const ComplexityLevel = Schema.Literals(["trivial", "low", "medium", "high", "systemic", "unknown"])
export type ComplexityLevel = Schema.Schema.Type<typeof ComplexityLevel>


// ── Workflow / Structure / Recovery Decisions ─────────────────────────────

export const SemanticTaskKind = Schema.Literals([
  "coding",
  "research",
  "git",
  "automation",
  "design",
  "review",
  "mixed",
  "general",
  "unknown",
])
export type SemanticTaskKind = Schema.Schema.Type<typeof SemanticTaskKind>

export class StructureNeed extends Schema.Class<StructureNeed>("Semantic.StructureNeed")({
  needed: Schema.Boolean,
  confidence: Schema.optional(Schema.Number),
  reasons: Schema.Array(Schema.String),
}) {}

export class RecoveryDecision extends Schema.Class<RecoveryDecision>("Semantic.RecoveryDecision")({
  actionClass: Schema.Literals(["retry_corrected", "alternate_tool", "inspect", "ask_user", "stop", "unknown"]),
  shouldRetry: Schema.Boolean,
  correctedAction: Schema.optional(Schema.String),
  preserveIntent: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
}) {}

// ── Design Direction ───────────────────────────────────────────────────────

export class DesignDirection extends Schema.Class<DesignDirection>("Semantic.DesignDirection")({
  productType: Schema.String,
  audience: Schema.String,
  primaryTask: Schema.String,
  density: Schema.Literals(["low", "medium", "medium-high", "high"]),
  visualCharacter: Schema.Array(Schema.String),
  layoutStrategy: Schema.Array(Schema.String),
  typographyRoles: Schema.Array(Schema.String),
  surfaceStrategy: Schema.Array(Schema.String),
  motionPurpose: Schema.Array(Schema.String),
  referenceTraits: Schema.Array(Schema.String),
  antiPatterns: Schema.Array(Schema.String),
  confidence: Schema.optional(Schema.Number),
}) {}

// ── Output Quality Review ──────────────────────────────────────────────────

export const QualityCategory = Schema.Literals([
  "architecture", "api_fit", "naming", "duplication", "complexity", "error_handling",
  "maintainability", "performance", "ui_quality", "design_taste", "accessibility", "slop", "other",
])
export type QualityCategory = Schema.Schema.Type<typeof QualityCategory>

export class QualityConcern extends Schema.Class<QualityConcern>("Semantic.QualityConcern")({
  category: QualityCategory,
  severity: Schema.Literals(["info", "warning", "blocker"]),
  evidence: Schema.String,
  recommendation: Schema.String,
  confidence: Schema.optional(Schema.Number),
}) {}

export class QualityReview extends Schema.Class<QualityReview>("Semantic.QualityReview")({
  verdict: Schema.Literals(["pass", "review", "block"]),
  concerns: Schema.Array(QualityConcern),
  strengths: Schema.optional(Schema.Array(Schema.String)),
  confidence: Schema.optional(Schema.Number),
}) {}

// ── TaskContext (input) ─────────────────────────────────────────────────────

export class RepositoryFacts extends Schema.Class<RepositoryFacts>("Semantic.RepositoryFacts")({
  root: Schema.optional(Schema.String),
  fileCount: Schema.optional(Schema.Number),
  sizeBytes: Schema.optional(Schema.Number),
  languages: Schema.optional(Schema.Array(Schema.String)),
  buildFiles: Schema.optional(Schema.Array(Schema.String)),
  manifests: Schema.optional(Schema.Array(Schema.String)),
  packageManagers: Schema.optional(Schema.Array(Schema.String)),
  rootDirectories: Schema.optional(Schema.Array(Schema.String)),
  detectedSystems: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class TaskContext extends Schema.Class<TaskContext>("Semantic.TaskContext")({
  request: Schema.String,
  relevantHistory: Schema.optional(Schema.Array(Schema.String)),
  taskSummary: Schema.optional(Schema.String),
  affectedFiles: Schema.optional(Schema.Array(Schema.String)),
  workingDirectory: Schema.optional(Schema.String),
  repositoryFacts: Schema.optional(RepositoryFacts),
  activeOwners: Schema.optional(Schema.Array(OwnerDescriptor)),
  explicitRestrictions: Schema.optional(Schema.Array(Schema.String)),
  knownToolState: Schema.optional(Schema.Unknown),
}) {}

// ── TaskAnalysis (composite result) ────────────────────────────────────────

export class TaskAnalysis extends Schema.Class<TaskAnalysis>("Semantic.TaskAnalysis")({
  taskTypes: Schema.Array(Schema.String),
  scope: ScopeLevel,
  complexity: ComplexityLevel,
  stack: StackDetection,
  playbooks: PlaybookSelection,
  verification: VerificationIntent,
  build: BuildIntent,
  risk: Schema.optional(RiskAssessment),
}) {}

// ── ClassifierDefinition ────────────────────────────────────────────────────

export const ModelClass = Schema.Literals(["fast", "standard", "deep"])
export type ModelClass = Schema.Schema.Type<typeof ModelClass>

export const ClassifierID = Schema.String.pipe(Schema.brand("Semantic.ClassifierID"))
export type ClassifierID = typeof ClassifierID.Type

export class ClassifierDefinition extends Schema.Class<ClassifierDefinition>("Semantic.ClassifierDefinition")({
  id: ClassifierID,
  version: Schema.Number,
  description: Schema.String,
  outputSchema: Schema.Unknown,
  prompt: Schema.String,
  modelClass: ModelClass,
  cachePolicy: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      ttlMs: Schema.optional(Schema.Number),
    }),
  ),
  retryPolicy: Schema.optional(
    Schema.Struct({
      maxRetries: Schema.optional(Schema.Number),
      backoffMs: Schema.optional(Schema.Number),
    }),
  ),
  fallbackPolicy: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      fallbackValue: Schema.optional(Schema.Unknown),
    }),
  ),
}) {}

// ── Provenance ──────────────────────────────────────────────────────────────

export class ClassifierProvenance extends Schema.Class<ClassifierProvenance>("Semantic.Provenance")({
  classifierId: Schema.String,
  classifierVersion: Schema.Number,
  promptVersion: Schema.optional(Schema.Number),
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  cacheHit: Schema.Boolean,
  latencyMs: Schema.Number,
  retryCount: Schema.Number,
  fallbackUsed: Schema.Boolean,
}) {}

// ── SlopDetection ───────────────────────────────────────────────────────────

export const SlopCategory = Schema.Literals([
  "engagement_bait",
  "filler_hedge",
  "hype_word",
  "prose_tell",
  "sycophancy",
  "self_cheer",
  "fake_success",
  "placeholder_contact",
  "dead_link",
  "hotlinked_image",
  "dead_image_service",
  "unverified_asset_claim",
  "default_font",
  "default_font_reflex",
  "glassmorphism",
  "emoji_abuse",
  "bold_overload",
  "decorative_gradient",
  "gradient_heading_text",
  "inline_onclick_link_bypass",
  "bento_grid_trope",
  "decorative_spinning_ring",
  "hover_bounce",
  "heading_formula",
  "form_label_heading",
  "repeated_opener",
  "emdash_density",
  "ocx_jargon",
  "apology_loop",
])
export type SlopCategory = Schema.Schema.Type<typeof SlopCategory>

export const SlopSeverity = Schema.Literals(["warning", "blocker"])
export type SlopSeverity = Schema.Schema.Type<typeof SlopSeverity>

export class SlopFinding extends Schema.Class<SlopFinding>("Semantic.SlopFinding")({
  category: SlopCategory,
  severity: SlopSeverity,
  evidence: Schema.String,
  fix: Schema.String,
  confidence: Schema.optional(Schema.Number),
}) {}

export class SlopDetection extends Schema.Class<SlopDetection>("Semantic.SlopDetection")({
  findings: Schema.Array(SlopFinding),
  overallSeverity: SlopSeverity,
  summary: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
}) {}
