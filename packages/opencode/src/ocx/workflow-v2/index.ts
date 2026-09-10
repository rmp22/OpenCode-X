export * from "./lanes"
export * from "./checklist"
export * from "./risk"
export * from "./watchdog"
export * from "./tuning"
export { Db } from "./db"
export type { LaneRow, ChecklistRunRow, GateRow, DeviationRow, GraphRunRow, NodeExecutionRow, LoopGuardRecordRow, GraphEventRow } from "./db"
export * from "./gate"
export * from "./gate/effect"
export * from "./graph"
export { Graph } from "./graph"

import { Lanes } from "./lanes"
import type { Lane, LaneKind } from "./lanes"
import { Checklist } from "./checklist"
import type { ChecklistItem, ChecklistRun } from "./checklist"
import { Gate } from "./gate"
import type { GateRecord, GateResolution } from "./gate"
import type { ActionEffect, RiskProfile } from "./risk"
import type { LaneBudget } from "./watchdog"

export type WorkflowV2Session = {
  readonly sessionID: string
  readonly openLane: (objective: string, kind?: LaneKind, risk?: RiskProfile, budget?: LaneBudget) => Lane
  readonly declareLanes: (declarations: readonly { objective: string; kind?: LaneKind; risk?: RiskProfile; budget?: LaneBudget }[]) => Lane[]
  readonly getLane: (laneID: string) => Lane | undefined
  readonly listLanes: () => Lane[]
  readonly listActiveLanes: () => Lane[]
  readonly executeAction: (laneID: string, toolName: string, input?: Record<string, unknown>) => {
    allowed: boolean
    effect: ActionEffect
    isDeviation: boolean
    requiresGate: boolean
    gate?: GateRecord
    deviationReason?: string
  }
  readonly resolveGate: (gateID: string, rawAnswer: string, metadata?: Record<string, unknown>) => {
    success: boolean
    resolution?: GateResolution
    error?: string
  }
  readonly signOut: (laneID: string, customItems?: readonly ChecklistItem[]) => ChecklistRun | undefined
  readonly recycle: (laneID: string, failingItem: ChecklistItem) => { lane: Lane; newRun: ChecklistRun } | undefined
  readonly forkLane: (parentLaneID: string, options: { objective: string; kind?: LaneKind; risk?: RiskProfile; budget?: LaneBudget; targetFiles?: readonly string[] }) => Lane
  readonly cancelLane: (laneID: string, reason?: string) => Lane | undefined
}

export function createWorkflowSession(sessionID: string): WorkflowV2Session {
  return {
    sessionID,
    openLane: (objective, kind, risk, budget) => Lanes.openLane({ sessionID, objective, kind, risk, budget }),
    declareLanes: (declarations) => Lanes.declareLanes(sessionID, declarations),
    getLane: (laneID) => Lanes.getLane(laneID),
    listLanes: () => Lanes.listLanes(sessionID),
    listActiveLanes: () => Lanes.listActiveLanes(sessionID),
    executeAction: (laneID, toolName, input) => Lanes.recordLaneAction(laneID, toolName, input),
    resolveGate: (gateID, rawAnswer, metadata) => Gate.resolveGate(gateID, rawAnswer, metadata),
    signOut: (laneID, customItems) => Lanes.startSignOutAudit(laneID, customItems),
    recycle: (laneID, failingItem) => Lanes.recycleLane(laneID, failingItem),
    forkLane: (parentLaneID, options) => Lanes.forkLane(parentLaneID, options),
    cancelLane: (laneID, reason) => Lanes.cancelLane(laneID, reason),
  }
}

export const LEGACY_CALL_SITES = {
  workflowRuntime: [
    "packages/opencode/src/tool/code-mode.ts",
    "packages/opencode/src/tool/invalid.ts",
    "packages/opencode/src/tool/shell.ts",
    "packages/opencode/src/session/llm/native-runtime.ts",
    "packages/opencode/src/session/prompt.ts",
    "packages/opencode/src/session/tools.ts",
    "packages/opencode/src/ocx/turn/state.ts",
    "packages/opencode/src/ocx/unified-gate.ts",
    "packages/opencode/src/ocx/ocx-pipeline.ts",
    "packages/opencode/src/ocx/ocx-session.ts",
    "packages/opencode/src/ocx/task-model.ts",
    "packages/opencode/src/ocx/shell-policy.ts",
    "packages/opencode/src/ocx/workflow-evidence.ts",
  ],
  workflowGate: [
    "packages/opencode/src/session/llm.ts",
    "packages/opencode/src/ocx/turn/gate.ts",
  ],
  workflowRouter: [
    "packages/opencode/src/ocx/workflow-runtime.ts",
  ],
  phaseTransition: [
    "packages/opencode/src/ocx/workflow-router.ts",
    "packages/opencode/src/ocx/workflow-runtime.ts",
  ],
} as const

export * as WorkflowV2 from "."
