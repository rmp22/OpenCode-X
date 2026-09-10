import { Effect } from "effect"
import { GraphBuilder } from "./builder"
import { LoopGuard } from "./guard"
import type { GraphDefinition, GraphNode, NodeExecutionResult } from "./types"

export const INVESTIGATION_NODES = {
  intake: "investigation:intake",
  hypothesize: "investigation:hypothesize",
  probe: "investigation:probe",
  synthesize: "investigation:synthesize",
} as const

export interface InvestigationState {
  readonly objective: string
  readonly targetModules: readonly string[]
  readonly hypotheses: readonly string[]
  readonly verifiedFacts: readonly string[]
  readonly evidenceLog: readonly string[]
}

export function createInvestigationPipeline(
  objective: string,
  targetModules: readonly string[] = [],
): GraphDefinition<InvestigationState> {
  const intakeNode: GraphNode<unknown, unknown, InvestigationState> = {
    id: INVESTIGATION_NODES.intake,
    label: "Intake & Boundary Scoping",
    kind: "inspect",
    allowedTools: ["ocx_context", "ocx_codebase"],
    budget: { maxTurns: 2, timeoutMs: 30_000, maxToolCalls: 4 },
    microPromptTemplate: "Analyze the objective and identify exact module boundaries.",
    execute: (input, state) =>
      Effect.succeed({
        status: "success",
        output: { scoped: true },
        durationMs: 10,
      }),
    route: () => ({ _tag: "Goto", targetNode: INVESTIGATION_NODES.hypothesize }),
  }

  const hypothesizeNode: GraphNode<unknown, unknown, InvestigationState> = {
    id: INVESTIGATION_NODES.hypothesize,
    label: "Formulate Root Cause Hypotheses",
    kind: "plan",
    allowedTools: ["ocx_codebase"],
    budget: { maxTurns: 2, timeoutMs: 30_000, maxToolCalls: 2 },
    microPromptTemplate: "Formulate concrete, falsifiable hypotheses for the root cause.",
    execute: (input, state) =>
      Effect.succeed({
        status: "success",
        output: { hypothesesFormed: true },
        durationMs: 10,
      }),
    route: () => ({ _tag: "Goto", targetNode: INVESTIGATION_NODES.probe }),
  }

  const probeNode: GraphNode<unknown, unknown, InvestigationState> = {
    id: INVESTIGATION_NODES.probe,
    label: "Inspect and Verify Evidence",
    kind: "verify",
    allowedTools: ["read", "glob", "grep", "ocx_session"],
    budget: { maxTurns: 5, timeoutMs: 60_000, maxToolCalls: 10 },
    microPromptTemplate: "Inspect the source code and logs to verify each hypothesis.",
    execute: (input, state) =>
      Effect.succeed({
        status: "success",
        output: { verified: true },
        durationMs: 20,
      }),
    route: () => ({ _tag: "Goto", targetNode: INVESTIGATION_NODES.synthesize }),
  }

  const synthesizeNode: GraphNode<unknown, unknown, InvestigationState> = {
    id: INVESTIGATION_NODES.synthesize,
    label: "Synthesize Findings",
    kind: "signoff",
    allowedTools: [],
    budget: { maxTurns: 1, timeoutMs: 30_000, maxToolCalls: 0 },
    microPromptTemplate: "Synthesize verified findings into a structured diagnosis.",
    execute: (input, state) =>
      Effect.succeed({
        status: "success",
        output: { findings: state.verifiedFacts },
        durationMs: 5,
      }),
    route: () => ({ _tag: "Complete", verdict: "completed" }),
  }

  return new GraphBuilder<InvestigationState>()
    .addNode(intakeNode)
    .addNode(hypothesizeNode)
    .addNode(probeNode)
    .addNode(synthesizeNode)
    .setInitialNode(intakeNode.id)
    .build("investigation-pipeline", "System Investigation Pipeline")
}

export const MUTATION_NODES = {
  planPatch: "mutation:plan-patch",
  applyPatch: "mutation:apply-patch",
  typecheck: "mutation:typecheck",
  runTests: "mutation:run-tests",
  diagnoseRepair: "mutation:diagnose-repair",
} as const

export interface CodeMutationState {
  readonly objective: string
  readonly targetFiles: readonly string[]
  readonly testCommand: string
  readonly diff?: string
  readonly compilerErrors?: readonly string[]
  readonly testOutput?: string
  readonly lastErrorSignature?: string
  readonly lastDiffHash?: string
  readonly testsPassed: boolean
}

export function createCodeMutationPipeline(config: {
  readonly id?: string
  readonly objective: string
  readonly targetFiles: readonly string[]
  readonly testCommand: string
  readonly maxRepairCycles?: number
  readonly testExecutor?: (state: CodeMutationState) => Effect.Effect<{ passed: boolean; errorSignature?: string; output?: string }>
  readonly patchExecutor?: (state: CodeMutationState) => Effect.Effect<{ diffApplied: boolean; diffHash?: string }>
}): GraphDefinition<CodeMutationState> {
  const planPatchNode: GraphNode<unknown, unknown, CodeMutationState> = {
    id: MUTATION_NODES.planPatch,
    label: "Plan Minimal Surgical Diff",
    kind: "plan",
    allowedTools: ["read", "grep"],
    budget: { maxTurns: 2, timeoutMs: 45_000, maxToolCalls: 4 },
    microPromptTemplate: "Inspect target code and formulate the minimal diff required.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { planned: true },
        durationMs: 10,
      }),
    route: () => ({ _tag: "Goto", targetNode: MUTATION_NODES.applyPatch }),
  }

  const applyPatchNode: GraphNode<unknown, unknown, CodeMutationState> = {
    id: MUTATION_NODES.applyPatch,
    label: "Apply Code Mutation",
    kind: "mutate",
    allowedTools: ["edit", "write"],
    budget: { maxTurns: 2, timeoutMs: 60_000, maxToolCalls: 6 },
    microPromptTemplate: "Apply the planned patch surgically without unrelated churn.",
    execute: (input, state) =>
      Effect.gen(function* () {
        if (config.patchExecutor) {
          const res = yield* config.patchExecutor(state)
          return {
            status: "success",
            output: res,
            diffHash: res.diffHash,
            durationMs: 20,
          }
        }
        return {
          status: "success",
          output: { diffApplied: true },
          diffHash: LoopGuard.computeDiffHash("diff --git a/test b/test\n+fix"),
          durationMs: 15,
        }
      }),
    route: () => ({ _tag: "Goto", targetNode: MUTATION_NODES.typecheck }),
  }

  const typecheckNode: GraphNode<unknown, unknown, CodeMutationState> = {
    id: MUTATION_NODES.typecheck,
    label: "Static Analysis & Typecheck",
    kind: "verify",
    allowedTools: ["bash"],
    budget: { maxTurns: 1, timeoutMs: 60_000, maxToolCalls: 1 },
    microPromptTemplate: "Verify typescript compiles cleanly without type errors.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { clean: true },
        durationMs: 50,
      }),
    route: (result) => {
      if (result.status === "failure") {
        return { _tag: "Goto", targetNode: MUTATION_NODES.diagnoseRepair }
      }
      return { _tag: "Goto", targetNode: MUTATION_NODES.runTests }
    },
  }

  const runTestsNode: GraphNode<unknown, unknown, CodeMutationState> = {
    id: MUTATION_NODES.runTests,
    label: "Execute Verification Tests",
    kind: "verify",
    allowedTools: ["bash"],
    budget: { maxTurns: 1, timeoutMs: 120_000, maxToolCalls: 1 },
    microPromptTemplate: "Run targeted test suite to confirm correctness.",
    execute: (input, state) =>
      Effect.gen(function* () {
        if (config.testExecutor) {
          const res = yield* config.testExecutor(state)
          return {
            status: res.passed ? "success" : "failure",
            output: res,
            errorSignature: res.errorSignature,
            durationMs: 100,
          }
        }
        return {
          status: state.testsPassed ? "success" : "failure",
          output: { passed: state.testsPassed },
          errorSignature: state.testsPassed ? undefined : state.lastErrorSignature,
          durationMs: 100,
        }
      }),
    route: (result) => {
      const output = result.output as { passed?: boolean } | undefined
      if (result.status === "success" && output?.passed !== false) {
        return { _tag: "Complete", verdict: "completed" }
      }
      return {
        _tag: "Loop",
        targetNode: MUTATION_NODES.diagnoseRepair,
        maxCycles: config.maxRepairCycles ?? 3,
        reason: "Test failure; route to diagnose & repair loop",
      }
    },
  }

  const diagnoseRepairNode: GraphNode<unknown, unknown, CodeMutationState> = {
    id: MUTATION_NODES.diagnoseRepair,
    label: "Diagnose Test Failure & Plan Repair",
    kind: "repair",
    allowedTools: ["read", "grep"],
    budget: { maxTurns: 2, timeoutMs: 45_000, maxToolCalls: 4 },
    microPromptTemplate: "Analyze the exact test failure output and formulate surgical fix.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { repairPlanned: true },
        durationMs: 15,
      }),
    route: () => ({ _tag: "Goto", targetNode: MUTATION_NODES.applyPatch }),
  }

  return new GraphBuilder<CodeMutationState>()
    .addNode(planPatchNode)
    .addNode(applyPatchNode)
    .addNode(typecheckNode)
    .addNode(runTestsNode)
    .addNode(diagnoseRepairNode)
    .setInitialNode(planPatchNode.id)
    .build(config.id ?? "code-mutation-pipeline", "Precision Code Mutation & Repair Pipeline")
}

export type FastFixState = {
  readonly objective: string
  readonly targetFile?: string
  readonly patchApplied?: boolean
  readonly verified?: boolean
}

export function createFastFixPipeline(config: {
  readonly id?: string
  readonly objective: string
  readonly targetFile?: string
}): GraphDefinition<FastFixState> {
  const nodes = new Map<string, GraphNode<unknown, unknown, FastFixState>>()

  const surgicalPatchNode: GraphNode<unknown, unknown, FastFixState> = {
    id: "fast-fix:surgical-patch",
    label: "Surgical Patch",
    allowedTools: ["read", "edit", "patch"],
    budget: { maxTurns: 2, timeoutMs: 30_000, maxToolCalls: 3 },
    microPromptTemplate: `Apply surgical, localized diff for: ${config.objective}${config.targetFile ? ` on ${config.targetFile}` : ""}.`,
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { patchApplied: true },
        durationMs: 10,
      }),
    route: () => ({ _tag: "Goto", targetNode: "fast-fix:quick-verify" }),
  }

  const quickVerifyNode: GraphNode<unknown, unknown, FastFixState> = {
    id: "fast-fix:quick-verify",
    label: "Quick Verification",
    allowedTools: ["bash"],
    budget: { maxTurns: 1, timeoutMs: 30_000, maxToolCalls: 2 },
    microPromptTemplate: "Run static check or fast unit test to verify surgical change.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { verified: true },
        durationMs: 10,
      }),
    route: (result) => {
      if (result.status === "success") {
        return { _tag: "Complete", verdict: "completed" }
      }
      return {
        _tag: "Loop",
        targetNode: "fast-fix:surgical-patch",
        maxCycles: 2,
        reason: "Quick verification failed; adjust surgical patch",
      }
    },
  }

  nodes.set(surgicalPatchNode.id, surgicalPatchNode)
  nodes.set(quickVerifyNode.id, quickVerifyNode)

  return {
    id: config.id ?? "fast-fix-pipeline",
    name: "Fast-Fix Pipeline",
    initialNodeId: surgicalPatchNode.id,
    nodes,
  }
}

export type AuditState = {
  readonly scope?: readonly string[]
  readonly inspectionFindings?: readonly string[]
  readonly violations?: readonly string[]
  readonly report?: string
}

export function createAuditPipeline(config: {
  readonly id?: string
  readonly scope?: readonly string[]
}): GraphDefinition<AuditState> {
  const nodes = new Map<string, GraphNode<unknown, unknown, AuditState>>()

  const inspectScopeNode: GraphNode<unknown, unknown, AuditState> = {
    id: "audit:inspect-scope",
    label: "Inspect Target Scope",
    allowedTools: ["read", "glob", "grep"],
    budget: { maxTurns: 3, timeoutMs: 45_000, maxToolCalls: 8 },
    microPromptTemplate: "Inspect target code surface, security boundaries, and style compliance.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { inspected: true },
        durationMs: 15,
      }),
    route: () => ({ _tag: "Goto", targetNode: "audit:synthesize-report" }),
  }

  const synthesizeReportNode: GraphNode<unknown, unknown, AuditState> = {
    id: "audit:synthesize-report",
    label: "Synthesize Audit Report",
    allowedTools: ["read"],
    budget: { maxTurns: 1, timeoutMs: 30_000, maxToolCalls: 2 },
    microPromptTemplate: "Synthesize findings, security invariants, and actionable remediation items.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { completed: true },
        durationMs: 10,
      }),
    route: () => ({ _tag: "Complete", verdict: "completed" }),
  }

  nodes.set(inspectScopeNode.id, inspectScopeNode)
  nodes.set(synthesizeReportNode.id, synthesizeReportNode)

  return {
    id: config.id ?? "audit-pipeline",
    name: "Read-Only Audit & Security Review Pipeline",
    initialNodeId: inspectScopeNode.id,
    nodes,
  }
}

export type ResearchVerificationState = {
  readonly paperUrl?: string
  readonly specInvariants?: readonly string[]
  readonly implementationAudit?: readonly string[]
  readonly unmetRequirements?: readonly string[]
  readonly verificationPassed?: boolean
  readonly cycleCount?: number
}

export function createResearchVerificationPipeline(config: {
  readonly id?: string
  readonly paperUrl?: string
  readonly maxCycles?: number
} = {}): GraphDefinition<ResearchVerificationState> {
  const nodes = new Map<string, GraphNode<unknown, unknown, ResearchVerificationState>>()
  const maxCycles = config.maxCycles ?? 3

  const readSpecNode: GraphNode<unknown, unknown, ResearchVerificationState> = {
    id: "research:read-spec",
    label: "Read Research Paper & Ground Spec Invariants",
    allowedTools: ["webfetch", "read"],
    budget: { maxTurns: 2, timeoutMs: 45_000, maxToolCalls: 4 },
    microPromptTemplate:
      "Read the research paper or specification thoroughly. Extract explicit, verifiable invariants and architectural requirements.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { specRead: true },
        durationMs: 10,
      }),
    route: () => ({
      _tag: "Goto",
      targetNode: "research:check-implementation",
    }),
  }

  const checkImplNode: GraphNode<unknown, unknown, ResearchVerificationState> = {
    id: "research:check-implementation",
    label: "Check Implementation Against Spec Invariants",
    allowedTools: ["read", "glob", "grep"],
    budget: { maxTurns: 3, timeoutMs: 60_000, maxToolCalls: 8 },
    microPromptTemplate:
      "Inspect the current implementation files and data structures. Map each paper requirement to concrete code paths and identify any missing capabilities or discrepancies.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { audited: true },
        durationMs: 10,
      }),
    route: () => ({
      _tag: "Goto",
      targetNode: "research:evaluate-gaps",
    }),
  }

  const evaluateGapsNode: GraphNode<unknown, unknown, ResearchVerificationState> = {
    id: "research:evaluate-gaps",
    label: "Evaluate Requirements: All Met or Gaps Detected?",
    allowedTools: ["read"],
    budget: { maxTurns: 1, timeoutMs: 20_000, maxToolCalls: 2 },
    microPromptTemplate:
      "Evaluate whether the implementation meets all requirements and goals of the paper. If gaps exist, route to repair; if all pass, complete loop.",
    execute: (_input, state) => {
      const hasGaps = (state?.unmetRequirements?.length ?? 0) > 0 || state?.verificationPassed === false
      return Effect.succeed({
        status: "success",
        output: { allRequirementsMet: !hasGaps },
        durationMs: 10,
      })
    },
    route: (result) => {
      const output = result?.output as { allRequirementsMet?: boolean } | undefined
      if (output?.allRequirementsMet) {
        return { _tag: "Complete", verdict: "completed" }
      }
      return {
        _tag: "Goto",
        targetNode: "research:mutate-repair",
      }
    },
  }

  const mutateRepairNode: GraphNode<unknown, unknown, ResearchVerificationState> = {
    id: "research:mutate-repair",
    label: "Mutate and Repair Gaps",
    allowedTools: ["edit", "write", "bash"],
    budget: { maxTurns: 3, timeoutMs: 90_000, maxToolCalls: 6 },
    microPromptTemplate:
      "Apply surgical, non-breaking mutations to close the gaps between the specification and implementation.",
    execute: () =>
      Effect.succeed({
        status: "success",
        output: { repaired: true },
        durationMs: 10,
      }),
    route: () => ({
      _tag: "Loop",
      targetNode: "research:check-implementation",
      maxCycles,
      reason: "Loop edge: re-verify patched implementation against specification requirements until all invariants pass",
    }),
  }

  nodes.set(readSpecNode.id, readSpecNode)
  nodes.set(checkImplNode.id, checkImplNode)
  nodes.set(evaluateGapsNode.id, evaluateGapsNode)
  nodes.set(mutateRepairNode.id, mutateRepairNode)

  return {
    id: config.id ?? "research-verification-pipeline",
    name: "Research-to-Implementation Spec Verification Loop",
    initialNodeId: readSpecNode.id,
    nodes,
  }
}

export * as Pipelines from "./pipelines"
