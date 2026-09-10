import type { Tool as AITool } from "ai"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { SessionID } from "../session/schema"
import { OCXSession } from "./ocx-session"
import { PracticePackTool } from "./practice-pack-tool"
import { createPlaybookTool } from "./playbook-tool"
import { createPlanTool } from "./plan-tool"
import type { OCXDb } from "./ocx-db"
import type { Operation } from "./workflow"

type ToolMap = Record<string, AITool>

export function install(input: {
  readonly tools: ToolMap
  readonly sessionID: SessionID
  readonly messages: readonly SessionV1.WithParts[]
  readonly workflow?: string
  readonly operation?: Operation
  readonly pipelineEnabled: boolean
  readonly practicesEnabled: boolean
  readonly turnDone: boolean
  readonly workdir: string
  readonly store?: OCXDb.Store
}): void {
  if (!input.pipelineEnabled) input.tools.ocx_playbook = createPlaybookTool()
  if (input.pipelineEnabled) {
    input.tools.ocx_session = OCXSession.create({
      sessionID: input.sessionID,
      messages: input.messages,
      workflow: input.workflow,
      ...(input.operation ? { operation: input.operation } : {}),
      store: input.store,
    })
    if (input.store && !input.turnDone)
      input.tools.ocx_plan = createPlanTool({
        sessionID: input.sessionID,
        workdir: input.workdir,
        messages: input.messages,
        store: input.store,
      })
  }
  // Pipeline mode selects and injects applicable practice packs itself. A
  // model-facing lookup tool only makes weak models guess pack names and spend
  // turns loading guidance that is already runtime-managed. Keep manual lookup
  // for non-pipeline/legacy use only.
  if (!input.practicesEnabled || input.pipelineEnabled) return
  const practiceTool = PracticePackTool.createPracticePackTool()
  if (practiceTool) input.tools.ocx_practice = practiceTool
}

function hasRecordedHeader(messages: readonly SessionV1.WithParts[]): boolean {
  return messages.some((message) =>
    message.parts.some(
      (part) => part.type === "tool" && part.tool === "ocx_header" && part.state.status === "completed",
    ),
  )
}

export * as PromptTools from "./prompt-tools"
