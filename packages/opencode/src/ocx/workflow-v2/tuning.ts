import { getProfile, type ModelBehaviorProfile } from "@/ocx/model-profile"
import type { GraphNode, GraphExecutionResult } from "./graph/types"
import type { LaneKind } from "./lanes"

export type IntelligenceTier = "frontier" | "reasoning" | "standard" | "compact"

export type AgentTuningConfig = {
  readonly modelId: string
  readonly tier: IntelligenceTier
  readonly maxLoopCycles: number
  readonly watchdogSensitivity: "strict" | "standard" | "lenient"
  readonly stallThreshold: number
  readonly duplicateCallLimit: number
  readonly verificationDepth: "exhaustive" | "standard" | "minimal"
  readonly thinkingBudget: number
  readonly contextWindowBudget: number
}

export type AgentLoopIterationRecord = {
  readonly cycle: number
  readonly timestamp: number
  readonly action: string
  readonly outcome: "success" | "failure" | "progress" | "stalled"
  readonly signature?: string
  readonly diffHash?: string
}

export type GraphCheckpoint = {
  readonly checkpointId: string
  readonly sessionID: string
  readonly timestamp: number
  readonly activeNodeId: string
  readonly lane: string
  readonly state: Record<string, unknown>
  readonly loopHistory: readonly AgentLoopIterationRecord[]
}

export type LoopProgressEvaluation = {
  readonly canContinue: boolean
  readonly cycleCount: number
  readonly isOscillating: boolean
  readonly isStalled: boolean
  readonly feedbackDirective?: string
  readonly recommendation: "continue" | "diverge" | "abort" | "replan"
}

export type SessionAgentTuning = {
  readonly config: AgentTuningConfig
  readonly activeDirective: string
  readonly allowedToolNarrowing?: readonly string[]
  readonly loopEvaluation?: LoopProgressEvaluation
}

const sessionCheckpoints = new Map<string, GraphCheckpoint[]>()
const sessionLoopHistories = new Map<string, Map<string, AgentLoopIterationRecord[]>>()

export function classifyIntelligenceTier(modelId: string): IntelligenceTier {
  const normalized = modelId.toLowerCase()
  if (normalized.includes("opus") || normalized.includes("o1") || normalized.includes("o3") || normalized.includes("gemini-1.5-pro") || normalized.includes("gemini-2.5-pro")) {
    return "reasoning"
  }
  if (normalized.includes("sonnet") || normalized.includes("gpt-4") || normalized.includes("flash") || normalized.includes("deepseek")) {
    return "frontier"
  }
  if (normalized.includes("haiku") || normalized.includes("mini") || normalized.includes("flash-lite") || normalized.includes("nano")) {
    return "compact"
  }
  return "standard"
}

export function computeAgentTuningConfig(modelId: string): AgentTuningConfig {
  const profile: ModelBehaviorProfile = getProfile(modelId)
  const tier = classifyIntelligenceTier(modelId)

  const maxLoopCycles = tier === "reasoning" ? 8 : tier === "frontier" ? 6 : tier === "compact" ? 3 : 4
  const watchdogSensitivity = profile.repeatedToolFailureRate > 0.2 || profile.workflowSkipRate > 0.25
    ? "strict"
    : tier === "compact"
    ? "strict"
    : "standard"

  const stallThreshold = watchdogSensitivity === "strict" ? 3 : tier === "reasoning" ? 6 : 4
  const duplicateCallLimit = watchdogSensitivity === "strict" ? 2 : 3
  const verificationDepth = profile.verificationSkipRate > 0.2 ? "exhaustive" : tier === "reasoning" ? "exhaustive" : "standard"
  const thinkingBudget = tier === "reasoning" ? 16000 : tier === "frontier" ? 8000 : 2000
  const contextWindowBudget = tier === "compact" ? 4000 : 12000

  return {
    modelId,
    tier,
    maxLoopCycles,
    watchdogSensitivity,
    stallThreshold,
    duplicateCallLimit,
    verificationDepth,
    thinkingBudget,
    contextWindowBudget,
  }
}

export function recordLoopIteration(
  sessionID: string,
  loopKey: string,
  record: Omit<AgentLoopIterationRecord, "timestamp">,
): AgentLoopIterationRecord {
  let sessionMap = sessionLoopHistories.get(sessionID)
  if (!sessionMap) {
    sessionMap = new Map()
    sessionLoopHistories.set(sessionID, sessionMap)
  }
  let history = sessionMap.get(loopKey)
  if (!history) {
    history = []
    sessionMap.set(loopKey, history)
  }

  const completeRecord: AgentLoopIterationRecord = {
    ...record,
    timestamp: Date.now(),
  }
  history.push(completeRecord)
  return completeRecord
}

export function evaluateLoopProgress(
  sessionID: string,
  loopKey: string,
  config: AgentTuningConfig,
): LoopProgressEvaluation {
  const history = sessionLoopHistories.get(sessionID)?.get(loopKey) ?? []
  const cycleCount = history.length

  if (cycleCount === 0) {
    return {
      canContinue: true,
      cycleCount: 0,
      isOscillating: false,
      isStalled: false,
      recommendation: "continue",
    }
  }

  const signatures = history.map((h) => h.signature).filter((s): s is string => Boolean(s))
  const isOscillating = signatures.length >= 3 &&
    signatures[signatures.length - 1] === signatures[signatures.length - 3] &&
    signatures[signatures.length - 1] !== signatures[signatures.length - 2]

  const recentFailures = history.slice(-config.stallThreshold).filter((h) => h.outcome === "failure" || h.outcome === "stalled")
  const isStalled = recentFailures.length >= config.stallThreshold

  if (cycleCount >= config.maxLoopCycles) {
    return {
      canContinue: false,
      cycleCount,
      isOscillating,
      isStalled: true,
      recommendation: "replan",
      feedbackDirective: `Loop iteration limit reached (${cycleCount}/${config.maxLoopCycles}). Stop repeating attempts and diagnose the root architectural blocker before proceeding.`,
    }
  }

  if (isOscillating) {
    return {
      canContinue: false,
      cycleCount,
      isOscillating: true,
      isStalled: false,
      recommendation: "diverge",
      feedbackDirective: "Oscillation detected between alternating error states. Do not flip-flop between previous patches. Step back and formulate a unified resolution that satisfies both constraints.",
    }
  }

  if (isStalled) {
    return {
      canContinue: false,
      cycleCount,
      isOscillating: false,
      isStalled: true,
      recommendation: "replan",
      feedbackDirective: `Stall detected after ${config.stallThreshold} consecutive non-progress iterations. Inspect the underlying failure output and re-verify your assumptions before making another edit.`,
    }
  }

  return {
    canContinue: true,
    cycleCount,
    isOscillating: false,
    isStalled: false,
    recommendation: "continue",
  }
}

export function saveCheckpoint(
  sessionID: string,
  activeNodeId: string,
  lane: string,
  state: Record<string, unknown>,
  loopKey?: string,
): GraphCheckpoint {
  const loopHistory = loopKey
    ? (sessionLoopHistories.get(sessionID)?.get(loopKey) ?? [])
    : []

  const checkpoint: GraphCheckpoint = {
    checkpointId: `cp-${sessionID}-${Date.now()}`,
    sessionID,
    timestamp: Date.now(),
    activeNodeId,
    lane,
    state: { ...state },
    loopHistory: [...loopHistory],
  }

  const list = sessionCheckpoints.get(sessionID) ?? []
  list.push(checkpoint)
  if (list.length > 20) {
    list.shift()
  }
  sessionCheckpoints.set(sessionID, list)
  return checkpoint
}

export function restoreCheckpoint(
  sessionID: string,
  checkpointId?: string,
): GraphCheckpoint | undefined {
  const list = sessionCheckpoints.get(sessionID)
  if (!list || list.length === 0) {
    return undefined
  }
  if (checkpointId) {
    return list.find((cp) => cp.checkpointId === checkpointId)
  }
  return list[list.length - 1]
}

export function clearCheckpoints(sessionID: string): void {
  sessionCheckpoints.delete(sessionID)
  sessionLoopHistories.delete(sessionID)
}

export function generateNodeSteeringDirective(
  node: Pick<GraphNode<unknown, unknown, unknown>, "id">,
  lane: LaneKind | string,
  tier: IntelligenceTier,
): string {
  const nodeId = node.id.toLowerCase()
  if (nodeId.includes("discover") || nodeId.includes("intake") || nodeId.includes("explore")) {
    return tier === "compact"
      ? "Direct discovery: inspect only the immediate relevant source file and callers. Do not wander."
      : "Ground truth discovery: inspect authoritative type contracts, caller sites, and actual runtime code before designing changes."
  }
  if (nodeId.includes("plan")) {
    return "Plan with granular, verifiable steps. Specify target file paths and explicit check assertions."
  }
  if (nodeId.includes("mutate") || nodeId.includes("implement") || nodeId.includes("patch")) {
    return lane === "careful"
      ? "Careful execution: apply surgical, localized diffs. Avoid unrelated churn, preserve existing comments and formatting."
      : "Surgical execution: implement the focused change adhering to repo conventions. Ensure imports and types match."
  }
  if (nodeId.includes("verify") || nodeId.includes("test")) {
    return "Empirical verification: execute typecheck or targeted unit tests to validate the fix. Treat unverified assertions as unchecked."
  }
  if (nodeId.includes("review") || nodeId.includes("gate")) {
    return "Exit review: verify no unintended file mutations, dead code, or broken contracts remain before concluding."
  }
  return "Advance execution systematically toward verifiable completion."
}

export function tuneSessionAgent(options: {
  readonly modelId: string
  readonly sessionID: string
  readonly activeNode?: Pick<GraphNode<unknown, unknown, unknown>, "id">
  readonly lane?: LaneKind | string
  readonly loopKey?: string
}): SessionAgentTuning {
  const config = computeAgentTuningConfig(options.modelId)
  const lane = options.lane ?? "standard"
  const activeDirective = options.activeNode
    ? generateNodeSteeringDirective(options.activeNode, lane, config.tier)
    : "Systematic agent execution."

  const loopEvaluation = options.loopKey
    ? evaluateLoopProgress(options.sessionID, options.loopKey, config)
    : undefined

  const allowedToolNarrowing = config.watchdogSensitivity === "strict" && loopEvaluation?.isStalled
    ? ["read", "grep", "glob", "bash", "edit"]
    : undefined

  return {
    config,
    activeDirective: loopEvaluation?.feedbackDirective
      ? `${activeDirective}\n[FEEDBACK DIRECTIVE]: ${loopEvaluation.feedbackDirective}`
      : activeDirective,
    allowedToolNarrowing,
    loopEvaluation,
  }
}

export * as Tuning from "./tuning"
