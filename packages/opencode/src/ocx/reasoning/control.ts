import { Workflow, type WorkflowId } from "../workflow"

export type Profile = "light" | "normal" | "deep" | "recovery"
export type ReasoningProfile = Profile

export type Input = {
  readonly workflow?: string
  readonly profile?: Profile
  readonly phase?: string
  readonly workflowPhase?: string
  readonly hasFailure?: boolean
  readonly complexity?: "low" | "high"
  readonly failureSummary?: string
}
export type ControlInput = Input

export type Block = {
  readonly profile: Profile
  readonly content: string
  readonly tokens: number
}

export const PROTOCOL_VERSION = 2

const TOKENS: Record<Profile, number> = {
  light: 120,
  normal: 200,
  deep: 350,
  recovery: 300,
}

const CODING_RULES = [
  "For each step (Principal Engineering Standards - Ousterhout & Fowler):",
  "1. Ground Truth First: Inspect source code, caller contracts, and types before editing. Never guess.",
  "2. Deep Module Design: Keep interfaces simple and hide implementation complexity. Reuse before writing.",
  "3. Mental Trace: Trace execution paths with boundary inputs (null, empty, error branches) before typing.",
  "4. Surgical Precision: Apply the smallest coherent diff that solves the root cause without unrelated churn.",
  "5. Empirical Proof: Verify with compiler checks, unit tests, or build runs before concluding.",
  "6. Completion Discipline: Emit STATE: done only when all planned items and checks are empirically verified.",
]

const DEBUGGING_RULES = [
  "For each step (Diagnostic Engineering Standards - Agans' 9 Rules & Zeller):",
  "1. Make It Fail (Reproduce): Inspect error traces, reproduction steps, and logs before modifying code.",
  "2. Quit Thinking & Look: Inspect actual runtime state and variables rather than assuming how code runs.",
  "3. Isolate the Root Cause: Change one variable at a time to distinguish root cause from downstream symptoms.",
  "4. Surgical Fix: Repair only the failing mechanism; preserve all neighboring working logic.",
  "5. Regression Proof: Run tests to empirically prove the bug is resolved and no regressions were introduced.",
]

const DESIGN_RULES = [
  "For each step (UI/UX & Frontend Design Standards - Refactoring UI & Norman):",
  "1. Visual Hierarchy First: Ensure obvious eye-travel (Headline -> Subtitle -> Primary Action) via size/weight/color.",
  "2. Deliberate Tokens & Spacing: Use consistent spacing scales, curated typography, and high-contrast tokens.",
  "3. State Completeness: Design for all states (default, hover, active, loading, empty, and mobile viewports).",
  "4. Accessibility & Semantics: Use semantic HTML elements, accessible labels, and responsive layout grids.",
  "5. Viewport Verification: Empirically verify rendering, layout responsiveness, and user interaction.",
]

const RESEARCH_RULES = [
  "For each step (Research & Evidence Synthesis Standards):",
  "1. Primary Sources First: Inspect authoritative documentation, official APIs, and source code directly.",
  "2. Triangulation & Cross-Check: Verify claims across multiple sources and separate facts from speculation.",
  "3. Sourced Synthesis: Structure findings with clear citations, trade-offs, and actionable conclusions.",
  "4. Completeness: Ensure all questions and constraints are addressed with evidence-backed answers.",
]

const DOCUMENTATION_RULES = [
  "For each step (Technical Writing Standards - Diátaxis Framework):",
  "1. Source-of-Truth Fidelity: Verify function signatures, parameter names, and return types from real code.",
  "2. Structure by Purpose: Clearly separate reference, tutorial, how-to, and conceptual explanations.",
  "3. Runnable Examples: Provide verified, working code snippets and configuration examples.",
  "4. Clarity & Precision: Use simple, unambiguous language. Explain the 'why' alongside the 'how'.",
]

const REVIEW_RULES = [
  "For each step (Code & Security Review Standards - Google Engineering):",
  "1. Impartial Diff Audit: Review changes against requirements, architecture, security, and quality standards.",
  "2. Grounded Findings: Classify issues as blocker, suggestion, or question with exact quoted evidence.",
  "3. Blast Radius & Breaking Changes: Check downstream callers, API contracts, and performance implications.",
  "4. Actionable Guidance: Provide constructive, specific recommendations for every identified finding.",
]

const PERFORMANCE_RULES = [
  "For each step (Systems Performance Standards - Brendan Gregg's USE Method):",
  "1. Measure Before Optimizing: Establish concrete baseline metrics before modifying any code.",
  "2. Isolate Bottleneck (USE): Identify the primary bottleneck (Utilization, Saturation, or Errors).",
  "3. High-ROI Optimization: Apply targeted algorithmic/caching improvements with minimal complexity.",
  "4. Comparative Verification: Rerun the benchmark under identical conditions to empirically prove speedup.",
]

const OPERATIONS_RULES = [
  "For each step (Site Reliability & Operations Standards):",
  "1. Precondition Check: Inspect current system state, environment variables, and git working tree.",
  "2. Non-Destructive Safety: Use dry-runs and safe flags; never execute irreversible commands blindly.",
  "3. Bounded Step Execution: Execute atomic operational steps with clear rollback readiness.",
  "4. State Verification: Confirm the target environment or repository is in the expected healthy state.",
]

const DEEP_ADDITIONS = [
  "Deep mode (Complex Engineering Decisions):",
  "- Decompose the problem into clear, atomic, verifiable steps.",
  "- Identify hidden dependencies, downstream callers, and interface contracts.",
  "- Formulate and compare alternative solutions against simplicity and maintainability.",
  "- Define concrete verification checks before modifying critical code.",
]

const RECOVERY_ADDITIONS = [
  "Recovery mode (Root-Cause Diagnosis & Surgical Fix):",
  "- Analyze the exact error trace, compiler defect, or test failure output.",
  "- Identify the root cause rather than treating symptoms.",
  "- Apply a surgical patch to the specific failing code without rewriting working components.",
  "- Re-verify with targeted checks after applying the fix.",
]

function rulesForWorkflow(workflow?: string): readonly string[] {
  const canonical = Workflow.canonicalID(workflow) ?? workflow?.toLowerCase()
  switch (canonical) {
    case "debugging":
    case "incident":
      return DEBUGGING_RULES
    case "design":
      return DESIGN_RULES
    case "research":
      return RESEARCH_RULES
    case "documentation":
      return DOCUMENTATION_RULES
    case "review":
      return REVIEW_RULES
    case "performance":
      return PERFORMANCE_RULES
    case "environment":
    case "git":
    case "release":
      return OPERATIONS_RULES
    case "coding":
    case "migration":
    default:
      return CODING_RULES
  }
}

export function resolveProfile(input: Input): Profile {
  if (input.profile) return input.profile
  if (input.hasFailure) return "recovery"
  if (input.complexity === "high") return "deep"
  const phase = input.phase ?? input.workflowPhase
  if (phase === "validate" || phase === "verify" || phase === "fullcheck") return "deep"
  return "normal"
}
export const profileFor = resolveProfile

export function tokensForProfile(profile: Profile): number {
  return TOKENS[profile]
}

export function build(input: Input): string {
  const profile = resolveProfile(input)
  const phase = input.phase ?? input.workflowPhase ?? "unknown"
  const workflow = input.workflow ?? "general"
  const lines = [
    "=== OCX REASONING CONTROL ===",
    `protocol=${PROTOCOL_VERSION}`,
    `profile=${profile}`,
    `workflow=${workflow}`,
    `phase=${phase}`,
    `recovery=${input.hasFailure ? "yes" : "no"}`,
    "",
    "The runtime owns terminal state. STATE: done, STATE: needs_input, and STATE: blocked are absorbing for this turn.",
    "Never emit a terminal state as an intermediate progress marker. After a terminal state, do not plan another tool call.",
    "",
  ]

  if (profile === "light") {
    lines.push("Keep the current objective active and choose one next action that advances it.")
  } else {
    lines.push(...rulesForWorkflow(input.workflow))
    if (profile === "deep") lines.push("", ...DEEP_ADDITIONS)
    if (profile === "recovery" || input.hasFailure) lines.push("", ...RECOVERY_ADDITIONS)
  }

  if (input.failureSummary) lines.push("", `Failure evidence: ${input.failureSummary}`)
  lines.push("", "=== END OCX REASONING CONTROL ===")
  return lines.join("\n")
}

export function block(input: Input): Block {
  const profile = resolveProfile(input)
  return {
    profile,
    content: build(input),
    tokens: TOKENS[profile],
  }
}

export * as ReasoningControl from "./control"
