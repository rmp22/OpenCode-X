export * as ContextOrchestration from "./orchestration"

import { ContextExploration } from "./exploration"
import { ContextRenderer } from "./renderer"
import { ContextRetriever } from "./retriever"
import { ContextService } from "./service"
import type { Store } from "./store"
import type { ContextBudget, ContextPacket } from "./types"

export type TaskLookupInput = {
  readonly workdir: string
  readonly store?: Store
  readonly prompt: string
  readonly files?: readonly string[]
  readonly symbols?: readonly string[]
  readonly scopeHints?: readonly string[]
  readonly budget?: Partial<ContextBudget>
  readonly checkFreshness?: boolean
}

export type PromotionResult = {
  readonly promoted: boolean
  readonly packet?: ContextPacket
  readonly reason?: string
}

export type OwnerPromptInput = TaskLookupInput & {
  readonly taskPrompt: string
  readonly packet?: string
  readonly routeInstructions?: string
  readonly loadedSession?: boolean
}

export function packet(input: TaskLookupInput): ContextPacket | undefined {
  if (!input.prompt.trim() && !input.files?.length && !input.symbols?.length && !input.scopeHints?.length)
    return undefined
  try {
    let handle = ContextService.open({ root: input.workdir, store: input.store })
    if (input.checkFreshness) handle = ContextService.refresh(handle, ContextService.sourceSnapshot(handle)).handle
    const result = ContextRetriever.retrieve({
      context: handle.context,
      query: {
        repositoryID: handle.repositoryID,
        taskText: input.prompt,
        ...(input.files ? { files: input.files } : {}),
        ...(input.symbols ? { symbols: input.symbols } : {}),
        ...(input.scopeHints ? { scopeHints: input.scopeHints } : {}),
      },
      budget: input.budget,
    })
    return result.packet.pipelineIDs.length > 0 || result.packet.nodeIDs.length > 0 ? result.packet : undefined
  } catch {
    return undefined
  }
}

export function renderPacket(input: TaskLookupInput): string | undefined {
  const value = packet(input)
  return value ? ContextRenderer.renderAgentPacket(value) : undefined
}

export function ownerPrompt(input: OwnerPromptInput): string {
  const context = input.packet ?? (input.workdir ? renderPacket(input) : undefined)
  const findingInstruction = [
    "If you discover a reusable source-backed relationship, optionally report it in this exact final block:",
    "<ocx_context_findings>",
    '[{"subject":"...","relation":"calls","object":"...","confidence":"VERIFIED","evidence":[{"file":"relative/path","symbol":"optional","lineStart":1,"lineEnd":2,"contentHash":"sha256","observation":"what the source proves"}],"scope":"optional"}]',
    "</ocx_context_findings>",
    "Only include current source evidence. Do not include hypotheses or temporary observations.",
  ].join("\n")
  const instructions = input.loadedSession ? undefined : input.routeInstructions
  return [instructions, context, findingInstruction, input.taskPrompt].filter(Boolean).join("\n\n")
}

export function promoteTask(input: {
  readonly workdir: string
  readonly taskID: string
  readonly ownerID?: string
  readonly taskPrompt: string
  readonly resultText: string
  readonly sourceRevision?: string
  readonly store?: Store
}): PromotionResult {
  try {
    const handle = ContextService.open({ root: input.workdir, store: input.store })
    const findings = ContextExploration.parseFindingEnvelope(input.resultText, handle.root)
    if (findings.length === 0) return { promoted: false, reason: "no structured reusable findings were reported" }
    const verified = ContextService.verifyFindings(handle, findings)
    if (verified.length === 0)
      return { promoted: false, reason: "reported findings had no resolvable current source evidence" }
    const built = ContextExploration.build({
      repositoryID: handle.repositoryID,
      existing: handle.context,
      findings: verified,
      taskID: input.taskID,
      ...(input.ownerID ? { ownerID: input.ownerID } : {}),
      baseRevision: handle.context.manifest.lastSeenRevision,
      ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
      reason: "promote validated reusable finding from an owner task",
    })
    if (!built.transaction)
      return { promoted: false, reason: built.unknowns.join(" ") || "no finding was eligible for promotion" }
    const applied = ContextService.apply(handle, built.transaction)
    return {
      promoted: true,
      packet: ContextRetriever.retrieve({
        context: applied.context,
        query: { repositoryID: handle.repositoryID, taskText: input.taskPrompt },
      }).packet,
    }
  } catch (error) {
    return { promoted: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
