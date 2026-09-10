import { GraphEngine } from "@/ocx/graph/engine"
import { ClaimLifecycleManager } from "@/ocx/claims/manager"
import { runCheck, runChecks } from "@/ocx/verification/runner"
import type { CheckExecutionResult } from "@/ocx/verification/runner"
import { PolicyEngine } from "@/ocx/policy/engine"
import type { PolicyDecision } from "@/ocx/policy/types"
import type { ExecutionGraph, NodeId } from "@/ocx/graph/types"
import type { Citation, StructuredClaim } from "@/ocx/claims/types"

export interface StageCoordinatorConfig {
  readonly graph?: ExecutionGraph
  readonly sessionID: string
}

export class PipelineStageCoordinator {
  readonly graphEngine?: GraphEngine
  readonly claims: ClaimLifecycleManager

  constructor(config: StageCoordinatorConfig) {
    if (config.graph) {
      this.graphEngine = new GraphEngine({
        graph: config.graph,
        sessionID: config.sessionID,
      })
    }
    this.claims = new ClaimLifecycleManager()
  }

  evaluateToolPolicy(toolName: string, options?: { path?: string; command?: string }): PolicyDecision {
    return PolicyEngine.evaluate(toolName, options)
  }

  recordClaim(claim: StructuredClaim): StructuredClaim {
    return this.claims.assert(claim)
  }

  async verifyClaimCitation(citation: Citation): Promise<boolean> {
    return this.claims.verifyCitation(citation)
  }

  async executeCheck(command: string, cwd?: string): Promise<CheckExecutionResult> {
    return runCheck(command, { cwd })
  }

  async executeChecks(commands: readonly string[], cwd?: string): Promise<readonly CheckExecutionResult[]> {
    return runChecks(commands, { cwd })
  }

  advanceGraph(targetNodeId: NodeId, evidenceIds: readonly string[] = []) {
    if (!this.graphEngine) return undefined
    return this.graphEngine.transition(targetNodeId, evidenceIds)
  }

  routeToRepair(evidenceIds: readonly string[] = []) {
    if (!this.graphEngine) return undefined
    return this.graphEngine.transition("repair", evidenceIds)
  }
}

export * as PipelineStagesCoordinatorModule from "./stages"
