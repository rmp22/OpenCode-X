import type { MeasurementProvenance } from "./types"

export type MechanismStatus = "active" | "narrowed" | "disabled" | "deleted"

export type MechanismRecord = {
  readonly id: string
  readonly name: string
  readonly purpose: string
  readonly targetFailure: string
  readonly activation: string
  readonly tokenCostAvg: number
  readonly latencyMsAvg: number
  readonly benchmark: string
  readonly baselineScore: number
  readonly treatmentScore: number
  readonly regressionsCount: number
  readonly status: MechanismStatus
  readonly verdictReason: string
  readonly isEmpirical?: boolean
  readonly provenance?: MeasurementProvenance
}

export type ReleaseGateDecision = {
  readonly approvedForRelease: boolean
  readonly activeMechanismsCount: number
  readonly disabledOrNarrowedCount: number
  readonly blockingFailures: readonly string[]
  readonly mechanisms: readonly MechanismRecord[]
}

export const CANONICAL_MECHANISMS: readonly MechanismRecord[] = [
  {
    id: "mech_practice_packs",
    name: "PracticePacks",
    purpose: "Domain-specific coding guidance injection",
    targetFailure: "Subsystem convention drift",
    activation: "Matched domain in node context",
    tokenCostAvg: 250,
    latencyMsAvg: 15,
    benchmark: "eval:coding:domain-drift",
    baselineScore: 0.75,
    treatmentScore: 0.88,
    regressionsCount: 0,
    status: "narrowed",
    verdictReason: "Narrowed to targeted domain-match only; omitted when context budget exceeded",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_playbooks",
    name: "Playbooks",
    purpose: "Heuristic step-by-step guidance",
    targetFailure: "Ad-hoc task execution",
    activation: "Prompt envelope injection",
    tokenCostAvg: 400,
    latencyMsAvg: 25,
    benchmark: "eval:general:task-flow",
    baselineScore: 0.7,
    treatmentScore: 0.72,
    regressionsCount: 1,
    status: "disabled",
    verdictReason: "Disabled in favor of canonical capability DAG graph and acceptance checks",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_anti_slop",
    name: "Anti-Slop Reviewer",
    purpose: "Detect boilerplate, comments explaining code, and placeholder stubs",
    targetFailure: "AI generated slop and comments in codebase",
    activation: "Post-mutation file review",
    tokenCostAvg: 120,
    latencyMsAvg: 10,
    benchmark: "eval:code-quality:slop",
    baselineScore: 0.65,
    treatmentScore: 0.96,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Demonstrated 31% uplift in clean code without regressions",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_reasoning_prompts",
    name: "Reasoning Prompts",
    purpose: "Verbose chain-of-thought instructions",
    targetFailure: "Superficial reasoning",
    activation: "Pre-turn injection",
    tokenCostAvg: 600,
    latencyMsAvg: 40,
    benchmark: "eval:reasoning:cot",
    baselineScore: 0.8,
    treatmentScore: 0.81,
    regressionsCount: 0,
    status: "narrowed",
    verdictReason: "Trimmed to concise dual-anchor thinking format; saves 450 tokens per turn",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_planning",
    name: "Hierarchical Planning",
    purpose: "Goal -> Workstream -> WorkItem -> Check breakdown",
    targetFailure: "Task disorientation in multi-step workflows",
    activation: "Session startup and step completion",
    tokenCostAvg: 180,
    latencyMsAvg: 12,
    benchmark: "eval:coding:multi-step",
    baselineScore: 0.58,
    treatmentScore: 0.92,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Critical anchor for complex multi-file changes; keeps progress monotonic",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_owner_delegation",
    name: "Owner Delegation",
    purpose: "Route tasks to domain specialists with subsystem memory",
    targetFailure: "Cross-domain context contamination",
    activation: "Domain boundary crossing",
    tokenCostAvg: 150,
    latencyMsAvg: 18,
    benchmark: "eval:subsystem:isolation",
    baselineScore: 0.72,
    treatmentScore: 0.9,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Maintains clear domain ownership and lease isolation",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_context_retrieval",
    name: "Observation Cache & Selective Retrieval",
    purpose: "Avoid redundant search and read thrash",
    targetFailure: "Repeated shell search and token blowup",
    activation: "Tool execution and query resolution",
    tokenCostAvg: 50,
    latencyMsAvg: 5,
    benchmark: "eval:search:efficiency",
    baselineScore: 0.6,
    treatmentScore: 0.94,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Saves ~250 tokens per cached query and eliminates redundant rg/status calls",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_loop_heuristics",
    name: "Loop Controller & Circuit Breakers",
    purpose: "Detect infinite tool loops, repeated errors, and read thrashing",
    targetFailure: "Endless tool loop spending budget",
    activation: "Per-tool invocation tracking",
    tokenCostAvg: 20,
    latencyMsAvg: 2,
    benchmark: "eval:reliability:infinite-loops",
    baselineScore: 0.45,
    treatmentScore: 0.98,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Halts runaway execution and safely prompts recovery/pivots",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_claim_verifier",
    name: "Evidence-Bound Claim Verifier",
    purpose: "Tie statements to actual execution evidence",
    targetFailure: "Hallucinated or self-attested claims",
    activation: "Verification ladder and terminal checks",
    tokenCostAvg: 80,
    latencyMsAvg: 8,
    benchmark: "eval:correctness:evidence",
    baselineScore: 0.5,
    treatmentScore: 0.97,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Eliminates unsupported claims and enforces real execution proof",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_architecture_rubric",
    name: "Architecture-Fit Rubric",
    purpose: "Verify adherence to codebase boundaries and conventions",
    targetFailure: "Unidiomatic patterns and abstraction bloat",
    activation: "Pre-commit and exit gate evaluation",
    tokenCostAvg: 100,
    latencyMsAvg: 10,
    benchmark: "eval:architecture:fit",
    baselineScore: 0.68,
    treatmentScore: 0.89,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Repository-grounded checking prevents unwanted dependencies and architectural drift",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
  {
    id: "mech_tool_locks",
    name: "Tool Locks",
    purpose: "Lock thrashing tools on escalation level 2",
    targetFailure: "Repeated failing mutations or reads",
    activation: "Loop escalation level 2",
    tokenCostAvg: 10,
    latencyMsAvg: 1,
    benchmark: "eval:reliability:recovery",
    baselineScore: 0.62,
    treatmentScore: 0.85,
    regressionsCount: 0,
    status: "active",
    verdictReason: "Forces agent to rethink approach when a tool is blocked",
    isEmpirical: false,
    provenance: { kind: "calibration_prior", note: "Mock calibration values, NOT empirical benchmark results." },
  },
]

export function evaluateReleaseGate(
  mechanisms: readonly MechanismRecord[] = CANONICAL_MECHANISMS,
): ReleaseGateDecision {
  const blockingFailures: string[] = []
  let activeCount = 0
  let disabledOrNarrowed = 0

  for (const mech of mechanisms) {
    if (mech.status === "active" || mech.status === "narrowed") {
      if (mech.regressionsCount > 0) {
        blockingFailures.push("Mechanism " + mech.name + " has " + mech.regressionsCount + " regressions and cannot be active.")
      }
      if (mech.treatmentScore < mech.baselineScore) {
        blockingFailures.push("Mechanism " + mech.name + " treatment score (" + mech.treatmentScore + ") is worse than baseline (" + mech.baselineScore + ").")
      }
    }

    if (mech.status === "active") {
      activeCount++
    } else {
      disabledOrNarrowed++
    }
  }

  const approvedForRelease = blockingFailures.length === 0
  const decision: ReleaseGateDecision = {
    approvedForRelease,
    activeMechanismsCount: activeCount,
    disabledOrNarrowedCount: disabledOrNarrowed,
    blockingFailures,
    mechanisms,
  }
  return decision
}

export * as AblationGateModule from "./ablation-gate"
