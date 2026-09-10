import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { TurnServices } from "@/ocx/turn/types"
import { CognitiveEngine } from "@/ocx/cognitive"
import { Ledger } from "@/ocx/ledger"
import { OCXPipeline } from "@/ocx/ocx-pipeline"

type WithParts = SessionV1.WithParts

export function stageContext(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  workflowName: string,
  workflowPhase: string,
): { deltas: string[] } {
  const deltas: string[] = []
  const stepEntries = Ledger.ledger(messages)
  const stepChanged = Ledger.changedPaths(stepEntries)
  const stepPromptText = OCXPipeline.promptText(messages) ?? ""
  const cognitive = CognitiveEngine.renderExecutiveEnvelope({
    sessionID: services.sessionID,
    workflow: workflowName,
    phase: workflowPhase,
    entries: stepEntries,
    changedFiles: stepChanged,
    userPrompt: stepPromptText,
  })
  if (cognitive.diagnoses.length > 0 && cognitive.promptBlock) {
    deltas.push(cognitive.promptBlock)
  }

  return { deltas }
}

export * as StageContext from "./stage-context"
