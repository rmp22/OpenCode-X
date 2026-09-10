import { Effect } from "effect"
import { readdirSync } from "node:fs"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { TurnServices } from "@/ocx/turn/types"
import { BuildGuard } from "@/ocx/build-guard"
import { gateDirectiveFromMessagesAsync, reasoningThrashFeedback } from "@/ocx/slop-gate"
import { Stuck } from "@/ocx/reasoning/stuck"
import { LoopGuard } from "@/ocx/reasoning/loop-guard"
import { DebugLoop } from "@/ocx/debug-loop"

type WithParts = SessionV1.WithParts

export function stageGuards(
  services: TurnServices,
  messages: ReadonlyArray<WithParts>,
  workflowName?: string,
): Effect.Effect<{ deltas: string[] }> {
  const op = Effect.gen(function* () {
    const deltas: string[] = []
    try {
      const rootFiles = readdirSync(services.cwd)
      const system = BuildGuard.detectBuildSystemByRoot(rootFiles)
      if (system) deltas.push(BuildGuard.guardNote(system))
    } catch (_err) {
      void _err
    }

    const slop = yield* gateDirectiveFromMessagesAsync(messages)
    if (slop) deltas.push(slop)
    const thrash = reasoningThrashFeedback(messages)
    if (thrash) deltas.push(thrash)
    const stuck = Stuck.directive(messages)
    if (stuck) deltas.push(stuck)
    const loop = LoopGuard.directive(messages)
    if (loop) deltas.push(loop)
    const debug = workflowName === "debugging" ? DebugLoop.directive(messages) : undefined
    if (debug) deltas.push(debug)

    return { deltas }
  })
  return op
}

export * as StageGuards from "./stage-guards"
