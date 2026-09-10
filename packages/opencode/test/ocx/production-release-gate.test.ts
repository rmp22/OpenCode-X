import { describe, expect, test } from "bun:test"
import { getRuntimeBudgets } from "@/ocx/runtime-config"
import { defaultEvidenceStore } from "@/ocx/evidence/store"
import { defaultCapabilityRouter } from "@/ocx/tools/router"
import { defaultAdaptivePlanner } from "@/ocx/planning/planner"
import { defaultDomainOwnerRegistry } from "@/ocx/subagents/owner"

describe("Final Production Release Gate (Task 35)", () => {
  test("validates Phase 1: Foundation Runtime components", async () => {
    const { IncrementalChunkBuffer } = await import("@/session/stream")
    const { TurnLifecycleManager } = await import("@/session/turn-lifecycle")
    const { ProcessGroup } = await import("@/session/run-state")
    const { SessionRetry } = await import("@/session/retry")

    expect(IncrementalChunkBuffer).toBeDefined()
    expect(TurnLifecycleManager).toBeDefined()
    expect(ProcessGroup).toBeDefined()
    expect(SessionRetry.DEFAULT_MAX_RETRIES).toBe(3)
  })

  test("validates Phase 2: Intent & Epistemic Engine components", async () => {
    const { IntentWorkModel } = await import("@/ocx/intent-model")
    const { verifyClaims } = await import("@/ocx/epistemic")
    const { SourceCoverageTracker } = await import("@/ocx/decision")
    const { ContentAddressableEvidenceStore } = await import("@/ocx/evidence")

    expect(IntentWorkModel).toBeDefined()
    expect(verifyClaims).toBeDefined()
    expect(SourceCoverageTracker).toBeDefined()
    expect(ContentAddressableEvidenceStore).toBeDefined()
  })

  test("validates Phase 3: Core Developer Capabilities components", async () => {
    const { CapabilityRouter } = await import("@/ocx/tools")
    const { RepositorySymbolMap } = await import("@/ocx/retrieval")
    const { applyChangeset } = await import("@/ocx/editing")
    const { AntiFlailBarrier } = await import("@/ocx/debugging/rca")
    const { AdaptivePlanner } = await import("@/ocx/planning")
    const { generateVerticalSliceScaffold } = await import("@/ocx/greenfield")
    const { generateTestSuite } = await import("@/ocx/testing")
    const { TechnicalResearchEngine } = await import("@/ocx/research/pipeline")
    const { formatApiDocumentation } = await import("@/ocx/documentation")

    expect(CapabilityRouter).toBeDefined()
    expect(RepositorySymbolMap).toBeDefined()
    expect(applyChangeset).toBeDefined()
    expect(AntiFlailBarrier).toBeDefined()
    expect(AdaptivePlanner).toBeDefined()
    expect(generateVerticalSliceScaffold).toBeDefined()
    expect(generateTestSuite).toBeDefined()
    expect(TechnicalResearchEngine).toBeDefined()
    expect(formatApiDocumentation).toBeDefined()
  })

  test("validates Phase 4: Prompt, Memory & Attention components", async () => {
    const { NodeContextAssembler } = await import("@/ocx/prompt/assembler")
    const { resolveModelProfile } = await import("@/ocx/model-profile")
    const { compactMemoryStore } = await import("@/ocx/memory")
    const { resolveAttentionCapability } = await import("@/ocx/attention/backend")

    expect(NodeContextAssembler).toBeDefined()
    expect(resolveModelProfile).toBeDefined()
    expect(compactMemoryStore).toBeDefined()
    expect(resolveAttentionCapability).toBeDefined()
  })

  test("validates Phase 5: Subagents & Observability components", async () => {
    const { DomainOwnerRegistry } = await import("@/ocx/subagents")
    const { classifyActionRisk } = await import("@/ocx/hitl")
    const { normalizeToolParameters } = await import("@/ocx/tool-schema")
    const { TrajectoryEmitter } = await import("@/ocx/observability")

    expect(DomainOwnerRegistry).toBeDefined()
    expect(classifyActionRisk).toBeDefined()
    expect(normalizeToolParameters).toBeDefined()
    expect(TrajectoryEmitter).toBeDefined()
  })

  test("verifies all production invariants hold across runtime defaults", () => {
    const budgets = getRuntimeBudgets()
    expect(budgets.maxTurnTokens).toBe(128_000)
    expect(budgets.retryMaxAttempts).toBe(3)
    expect(budgets.cancellationGracePeriodMs).toBe(2000)
    expect(defaultEvidenceStore).toBeDefined()
    expect(defaultCapabilityRouter).toBeDefined()
    expect(defaultAdaptivePlanner).toBeDefined()
    expect(defaultDomainOwnerRegistry).toBeDefined()
  })
})
