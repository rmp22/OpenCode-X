import { createFallback, semanticKey, shouldReplace, terminalize, type ReasoningActivity, type ReasoningStatus, type ReasoningStatusContext, type ReasoningStatusSource } from "./status"
import { synthesizeTitle, validateCandidate, inferActivityFromTool, sanitizeTitle } from "./title"

export type RuntimeState = {
  current?: ReasoningStatus
  history: ReasoningStatus[]
  lastSemanticKey?: string
  lastTitle?: string
}

export class ReasoningRuntime {
  private state: RuntimeState = { history: [] }
  private terminal = false

  get current(): ReasoningStatus | undefined {
    return this.state.current
  }

  get isTerminal(): boolean {
    return this.terminal
  }

  start(input: { sessionID: string; messageID: string; taskObjective?: string }): ReasoningStatus {
    this.terminal = false
    const status = createFallback({ sessionID: input.sessionID, messageID: input.messageID, taskObjective: input.taskObjective })
    this.state.current = status
    this.state.lastSemanticKey = status.semanticKey
    this.state.lastTitle = status.title
    this.state.history.push(status)
    return status
  }

  updateFromTool(input: {
    sessionID: string
    messageID: string
    toolName: string
    args?: Record<string, unknown>
    capability?: string
    workflowPhase?: string
    workstreamID?: string
    ownerScope?: string
  }): ReasoningStatus {
    const activity = inferActivityFromTool(input.toolName)
    const target = extractTarget(input.toolName, input.args)
    const ctx: ReasoningStatusContext = {
      activity,
      action: toolAction(input.toolName),
      target,
      capability: input.capability,
      workflowPhase: input.workflowPhase,
      workstreamID: input.workstreamID,
      ownerScope: input.ownerScope,
      toolName: input.toolName,
    }
    const key = semanticKey(ctx)
    const title = synthesizeTitle(ctx)
    return this.upsert({ ...ctx, semanticKey: key, title, source: "tool", sessionID: input.sessionID, messageID: input.messageID, activity, target })
  }

  updateFromModelHint(input: {
    sessionID: string
    messageID: string
    activity?: ReasoningActivity
    action: string
    target?: string
    purpose?: string
    workflowPhase?: string
    workstreamID?: string
    currentTool?: string
    currentTarget?: string
  }): ReasoningStatus | undefined {
    const activity = input.activity ?? (input.currentTool ? inferActivityFromTool(input.currentTool) : "thinking")
    const ctx: ReasoningStatusContext = {
      activity,
      action: input.action,
      target: input.target,
      purpose: input.purpose,
      workflowPhase: input.workflowPhase,
      workstreamID: input.workstreamID,
      toolName: input.currentTool,
    }
    const key = semanticKey(ctx)
    const candidateTitle = synthesizeTitle(ctx)
    const validation = validateCandidate({
      title: candidateTitle,
      ctx,
      lastTitle: this.state.lastTitle,
      lastSemanticKey: this.state.lastSemanticKey,
      currentSemanticKey: key,
    })
    if (!validation.valid) {
      if (input.currentTool && input.currentTarget) {
        return this.updateFromTool({
          sessionID: input.sessionID,
          messageID: input.messageID,
          toolName: input.currentTool,
          args: { filePath: input.currentTarget },
          workflowPhase: input.workflowPhase,
          workstreamID: input.workstreamID,
        })
      }
      if (!this.state.current) return this.start({ sessionID: input.sessionID, messageID: input.messageID })
      return this.state.current
    }
    return this.upsert({
      ...ctx,
      semanticKey: key,
      title: validation.sanitized ?? candidateTitle,
      source: "model",
      sessionID: input.sessionID,
      messageID: input.messageID,
      activity,
      target: input.target,
    })
  }

  updateFromRecovery(input: {
    sessionID: string
    messageID: string
    failureSummary: string
    workflowPhase?: string
  }): ReasoningStatus {
    const activity: ReasoningActivity = "recovering"
    const ctx: ReasoningStatusContext = {
      activity,
      recoveryClass: sanitizeTitle(input.failureSummary).slice(0, 40),
      workflowPhase: input.workflowPhase,
    }
    const key = semanticKey(ctx)
    const title = synthesizeTitle(ctx)
    return this.upsert({ ...ctx, semanticKey: key, title, source: "recovery", sessionID: input.sessionID, messageID: input.messageID, activity })
  }

  updateFromVerification(input: { sessionID: string; messageID: string; target?: string }): ReasoningStatus {
    const ctx: ReasoningStatusContext = {
      activity: "verifying",
      target: input.target,
      action: "verify",
    }
    const key = semanticKey(ctx)
    const title = synthesizeTitle(ctx)
    return this.upsert({ ...ctx, semanticKey: key, title, source: "workflow", sessionID: input.sessionID, messageID: input.messageID, activity: "verifying", target: input.target })
  }

  upsert(input: {
    sessionID: string
    messageID: string
    activity: ReasoningActivity
    title: string
    semanticKey: string
    source: ReasoningStatusSource
    action?: string
    target?: string
    purpose?: string
    capability?: string
    workflowPhase?: string
    workstreamID?: string
    recoveryClass?: string
    ownerScope?: string
    toolName?: string
  }): ReasoningStatus {
    if (this.terminal && input.source !== "recovery") {
      return (
        this.state.current ??
        createFallback({
          sessionID: input.sessionID,
          messageID: input.messageID,
        })
      )
    }
    const now = Date.now()
    const current = this.state.current
    if (current && !shouldReplace(current, { semanticKey: input.semanticKey, source: input.source, title: input.title })) {
      return current
    }
    if (current && current.semanticKey === input.semanticKey && current.title === input.title) {
      current.updatedAt = now
      return current
    }
    const next: ReasoningStatus = {
      id: current?.id ?? `rs_${now}_${Math.random().toString(36).slice(2, 6)}`,
      sessionID: input.sessionID,
      messageID: input.messageID,
      activity: input.activity,
      title: sanitizeTitle(input.title),
      ...(input.action ? { action: input.action } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.purpose ? { purpose: input.purpose } : {}),
      semanticKey: input.semanticKey,
      source: input.source,
      startedAt: current && current.semanticKey === input.semanticKey ? current.startedAt : now,
      updatedAt: now,
      state: "active",
    }
    if (!next.title.trim()) next.title = synthesizeTitle({ activity: input.activity, target: input.target })
    this.state.current = next
    this.state.lastSemanticKey = input.semanticKey
    this.state.lastTitle = next.title
    this.state.history.push(next)
    return next
  }

  complete(state: "done" | "failed" | "interrupted" = "done"): ReasoningStatus | undefined {
    this.terminal = true
    if (!this.state.current) return undefined
    const next = terminalize(this.state.current, state)
    this.state.current = next
    this.state.history.push(next)
    return next
  }

  interrupt(): ReasoningStatus | undefined {
    return this.complete("interrupted")
  }

  clear(): void {
    this.terminal = false
    this.state = { history: [] }
  }

  snapshot(): RuntimeState {
    return { ...this.state, history: [...this.state.history] }
  }
}

function toolAction(toolName: string): string | undefined {
  switch (toolName) {
    case "read":
      return "read"
    case "write":
      return "create"
    case "edit":
    case "apply_patch":
      return "edit"
    case "grep":
      return "search"
    case "glob":
      return "find"
    case "bash":
      return "run"
    case "websearch":
      return "research"
    case "webfetch":
      return "fetch"
    case "task":
      return "delegate"
    default:
      return toolName
  }
}

function extractTarget(toolName: string, args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined
  const keys = ["filePath", "file_path", "path", "target", "query", "pattern", "url", "command", "description"]
  for (const key of keys) {
    const value = args[key]
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80)
  }
  if (toolName === "bash" && typeof args.command === "string") {
    const cmd = args.command.trim().slice(0, 80)
    return cmd
  }
  return undefined
}

export * as ReasoningRuntimeModule from "./runtime"
