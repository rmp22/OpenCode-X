import { describe, expect, test } from "bun:test"
import { ScopeEvaluator } from "@/ocx/scope/scope-evaluator"
import { ScopePolicy } from "@/ocx/scope/scope-policy"
import { ScopeBoundaryBuilder } from "@/ocx/scope/scope-boundary"
import { ScopeReevaluationHook } from "@/ocx/scope/reevaluation-hook"
import { SufficiencyReviewer } from "@/ocx/scope/sufficiency-review"
import { Policy } from "@/ocx/scope/policy"
import { Telemetry } from "@/ocx/scope/telemetry"

describe("scope evaluator", () => {
  test("evaluates scope with all low dimensions", () => {
    const result = ScopeEvaluator.evaluateScope({
      depth: 1,
      width: 1,
      coupling: 1,
      risk: 1,
      requestBreadth: 1,
    })
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.dimensions).toHaveLength(5)
  })

  test("evaluates scope with high dimensions", () => {
    const result = ScopeEvaluator.evaluateScope({
      depth: 4,
      width: 3,
      coupling: 4,
      risk: 4,
      requestBreadth: 3,
    })
    expect(result.depth).toBe(4)
    expect(result.width).toBe(3)
    expect(result.coupling).toBe(4)
    expect(result.risk).toBe(4)
    expect(result.requestBreadth).toBe(3)
  })

  test("clamps values to 0-5 range", () => {
    const result = ScopeEvaluator.evaluateScope({
      depth: 10,
      width: -1,
      coupling: 3,
      risk: 3,
      requestBreadth: 3,
    })
    expect(result.depth).toBe(5)
    expect(result.width).toBe(0)
  })

  test("derives scope level from exploration findings", () => {
    const findings = [
      { type: "root_cause", confidence: 0.8 },
      { type: "related_implementation", confidence: 0.7 },
    ]
    const intent = { taskKind: ["bug_fix"], qualityBar: "standard" as const }
    const result = ScopeEvaluator.evaluateFromExploration(findings, intent)
    expect(result.depth).toBeGreaterThanOrEqual(1)
  })
})

describe("scope policy", () => {
  test("chooses local for isolated low-risk bug", () => {
    const result = ScopePolicy.chooseScopeLevel({
      evaluation: { depth: 1, width: 1, coupling: 1, risk: 1, requestBreadth: 1, confidence: 0.9, dimensions: [] },
      intent: { taskKind: ["bug_fix"], minimalPatchRequested: false, qualityBar: "standard" },
    })
    expect(result.scopeLevel).toBe("local")
  })

  test("chooses feature for high coupling", () => {
    const result = ScopePolicy.chooseScopeLevel({
      evaluation: { depth: 3, width: 3, coupling: 4, risk: 3, requestBreadth: 2, confidence: 0.7, dimensions: [] },
      intent: { taskKind: ["bug_fix"], minimalPatchRequested: false, qualityBar: "standard" },
    })
    expect(result.scopeLevel).toBe("feature")
  })

  test("chooses structural for architecture tasks", () => {
    const result = ScopePolicy.chooseScopeLevel({
      evaluation: { depth: 3, width: 2, coupling: 3, risk: 2, requestBreadth: 2, confidence: 0.6, dimensions: [] },
      intent: { taskKind: ["architecture"], minimalPatchRequested: false, qualityBar: "standard" },
    })
    expect(result.scopeLevel).toBe("structural")
  })

  test("chooses subsystem for high risk", () => {
    const result = ScopePolicy.chooseScopeLevel({
      evaluation: { depth: 2, width: 2, coupling: 2, risk: 4, requestBreadth: 2, confidence: 0.8, dimensions: [] },
      intent: { taskKind: ["bug_fix"], minimalPatchRequested: false, qualityBar: "standard" },
    })
    expect(result.scopeLevel).toBe("subsystem")
  })
})

describe("scope boundary builder", () => {
  test("builds local boundary for isolated fix", () => {
    const result = ScopeBoundaryBuilder.buildBoundary({
      scopeLevel: "local",
      intent: { taskKind: ["bug_fix"], explicitScope: undefined, qualityBar: "standard", minimalPatchRequested: false, preserveUnrelatedWip: false, broadCleanupRequested: false, hardeningRequested: false, productionReadinessRequested: false, edgeCaseReviewRequested: false, architectureRequested: false },
      evaluation: { depth: 1, width: 1, coupling: 1, risk: 1, requestBreadth: 1 },
      primaryTarget: "Parser.parseCondition",
      relatedComponents: [],
    })
    expect(result.primary).toContain("Parser.parseCondition")
    expect(result.protected).toHaveLength(0)
  })

  test("protects unrelated WIP when requested", () => {
    const result = ScopeBoundaryBuilder.buildBoundary({
      scopeLevel: "component",
      intent: { taskKind: ["bug_fix"], explicitScope: undefined, qualityBar: "standard", minimalPatchRequested: false, preserveUnrelatedWip: true, broadCleanupRequested: false, hardeningRequested: false, productionReadinessRequested: false, edgeCaseReviewRequested: false, architectureRequested: false },
      evaluation: { depth: 2, width: 2, coupling: 2, risk: 2, requestBreadth: 2 },
      primaryTarget: "TaskView.render",
      relatedComponents: ["TaskModel", "TaskStore"],
    })
    expect(result.protected).toContain("unrelated user WIP")
  })
})

describe("scope reevaluation hook", () => {
  test("widens scope on new shared state discovery", () => {
    const result = ScopeReevaluationHook.reevaluateScope({
      currentScope: "local",
      intent: { taskKind: ["bug_fix"], explicitScope: undefined, qualityBar: "standard", minimalPatchRequested: false, preserveUnrelatedWip: false, broadCleanupRequested: false, hardeningRequested: false, productionReadinessRequested: false, edgeCaseReviewRequested: false, architectureRequested: false },
      newEvidence: ["shared state discovered in TaskStore"],
      discoveryTrigger: "new_shared_state",
    })
    expect(result.action).toBe("widen")
    expect(result.newScope).toBe("component")
  })

  test("narrows scope when root cause hypothesis changes", () => {
    const result = ScopeReevaluationHook.reevaluateScope({
      currentScope: "feature",
      intent: { taskKind: ["bug_fix"], explicitScope: undefined, qualityBar: "standard", minimalPatchRequested: false, preserveUnrelatedWip: false, broadCleanupRequested: false, hardeningRequested: false, productionReadinessRequested: false, edgeCaseReviewRequested: false, architectureRequested: false },
      newEvidence: ["only one serializer field mapping is wrong"],
      discoveryTrigger: "root_cause_hypothesis_changed",
    })
    expect(result.action).toBe("narrow")
    expect(result.newScope).toBe("component")
  })

  test("continues exploration for dependency findings", () => {
    const result = ScopeReevaluationHook.reevaluateScope({
      currentScope: "component",
      intent: { taskKind: ["bug_fix"], explicitScope: undefined, qualityBar: "standard", minimalPatchRequested: false, preserveUnrelatedWip: false, broadCleanupRequested: false, hardeningRequested: false, productionReadinessRequested: false, edgeCaseReviewRequested: false, architectureRequested: false },
      newEvidence: ["minor optimization opportunity found"],
      discoveryTrigger: "new_dependency_found",
    })
    expect(result.action).toBe("continue_exploration")
    expect(result.newScope).toBe("component")
  })
})

describe("sufficiency reviewer", () => {
  test("passes when all findings are fixed", () => {
    const result = SufficiencyReviewer.reviewSufficiency({
      findings: [
        { id: "f1", status: "fixed", description: "null check added", reason: "root cause" },
      ],
      scopeLevel: "local",
      rootCauseFixed: true,
      equivalentPathsChecked: true,
      edgeCasesChecked: true,
      consistencyChecked: true,
      architectureChecked: true,
      qualityBarMet: true,
      unrelatedChangesMade: false,
    })
    expect(result.complete).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  test("blocks when root cause is not fixed", () => {
    const result = SufficiencyReviewer.reviewSufficiency({
      findings: [
        { id: "f1", status: "fixed", description: "symptom patched", reason: "symptom" },
      ],
      scopeLevel: "local",
      rootCauseFixed: false,
      equivalentPathsChecked: true,
      edgeCasesChecked: true,
      consistencyChecked: true,
      architectureChecked: true,
      qualityBarMet: true,
      unrelatedChangesMade: false,
    })
    expect(result.complete).toBe(false)
    expect(result.blockers).toContain("Root cause is not fixed")
  })

  test("rejects invalid preservation reasons", () => {
    const result = SufficiencyReviewer.reviewSufficiency({
      findings: [
        { id: "f1", status: "intentionally_preserved", description: "would increase diff size", reason: "size", preservationReason: "diff_size" },
      ],
      scopeLevel: "local",
      rootCauseFixed: true,
      equivalentPathsChecked: true,
      edgeCasesChecked: true,
      consistencyChecked: true,
      architectureChecked: true,
      qualityBarMet: true,
      unrelatedChangesMade: false,
    })
    expect(result.invalidPreservations).toHaveLength(1)
    expect(result.invalidPreservations[0]).toContain("diff_size")
  })
})

describe("policy", () => {
  test("loads default policy", () => {
    const policy = Policy.loadPolicy(undefined)
    expect(policy.enabled).toBe(true)
    expect(policy.minimalPatch.default).toBe(false)
  })

  test("loads policy from JSON", () => {
    const json = { dynamic_scope: { enabled: true, default_strategy: "evidence_driven" } }
    const policy = Policy.loadPolicy(json)
    expect(policy.enabled).toBe(true)
    expect(policy.defaultStrategy).toBe("evidence_driven")
  })

  test("rejects invalid policy values", () => {
    const policy = Policy.loadPolicy("not an object")
    expect(policy.enabled).toBe(true)
  })
})

describe("telemetry", () => {
  test("creates telemetry record", () => {
    const result = Telemetry.createTelemetry({
      sessionId: "session-123",
      initialScope: "local",
      finalScope: "feature",
      scopeChanges: [
        { oldScope: "local", newScope: "component", evidence: ["shared state found"], reason: "new shared state" },
        { oldScope: "component", newScope: "feature", evidence: ["three affected implementations"], reason: "duplicate defect" },
      ],
      filesInspected: ["parser.ts", "task-store.ts"],
      filesChanged: ["parser.ts", "task-store.ts", "task-model.ts"],
      findingsAtCompletion: [
        { id: "f1", status: "fixed", description: "null check added", reason: "root cause" },
      ],
      reviewerVerdict: "appropriate",
    })
    expect(result.sessionId).toBe("session-123")
    expect(result.initialScope).toBe("local")
    expect(result.finalScope).toBe("feature")
    expect(Telemetry.scopeChanged(result)).toBe(true)
    expect(Telemetry.escalationCount(result)).toBe(2)
  })

  test("detects no scope change", () => {
    const result = Telemetry.createTelemetry({
      sessionId: "session-456",
      initialScope: "local",
      finalScope: "local",
      scopeChanges: [],
      filesInspected: ["parser.ts"],
      filesChanged: ["parser.ts"],
      findingsAtCompletion: [],
      reviewerVerdict: "appropriate",
    })
    expect(Telemetry.scopeChanged(result)).toBe(false)
  })
})
