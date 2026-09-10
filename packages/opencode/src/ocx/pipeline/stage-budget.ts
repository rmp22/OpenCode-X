import { BatchingAdvisor } from "@/ocx/batching"
import { Ledger } from "@/ocx/ledger"
import { TokenCompression } from "@/ocx/token-compression"
import type { TurnServices } from "@/ocx/turn/types"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import * as State from "@/ocx/turn/state"

type WithParts = SessionV1.WithParts

export function stageBudget(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  key: string,
): { deltas: string[] } {
  const deltas: string[] = []
  const batchingPlans = Ledger.ledger(messages as unknown as Ledger.Message[]).map((entry) => ({
    name: entry.kind === "command" ? entry.command : `${entry.kind}:${entry.path}`,
    kind: (entry.kind === "command" ? "command" : entry.kind === "read" ? "read" : entry.kind === "write" ? "write" : "edit") as "command" | "read" | "write" | "edit",
    ...(entry.kind !== "command" ? { path: entry.path } : {}),
    sequential: entry.kind === "command",
    batched: false,
  }))
  const batching = BatchingAdvisor.formatAdvisory(batchingPlans)
  if (batching) {
    const signature = JSON.stringify(batchingPlans.map((plan) => [plan.kind, plan.path, plan.name]))
    if (State.batchingSignatureOf(key) !== signature) {
      State.setBatchingSignature(key, signature)
      deltas.push(batching)
    }
  }

  TokenCompression.initSession({ sessionID: services.sessionID, cwd: services.cwd })
  const terminologyHeader = TokenCompression.renderTerminologyHeader(services.sessionID)
  if (terminologyHeader && !State.isTerminologyInjected(key)) {
    deltas.push(terminologyHeader)
    State.markTerminologyInjected(key)
  }

  return { deltas }
}

export * as StageBudget from "./stage-budget"
