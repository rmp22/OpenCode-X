import { Effect } from "effect"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { EvalRunner } from "./eval-runner"

export type SessionInput = {
  readonly agent?: string
  readonly model?: SessionPrompt.PromptInput["model"]
  readonly variant?: string
}

export function sessionExecutor(input: SessionInput = {}): EvalRunner.Executor<
  InstanceStore.Service | Session.Service | SessionPrompt.Service
> {
  return ({ fixture, workdir }) =>
    Effect.gen(function* () {
      const instances = yield* InstanceStore.Service
      return yield* instances.provide(
        { directory: workdir },
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const session = yield* sessions.create({
            title: `OCX Eval: ${fixture.name}`,
            agent: input.agent,
            model: input.model
              ? { id: input.model.modelID, providerID: input.model.providerID, variant: input.variant }
              : undefined,
          })
          const startedAt = Date.now()
          const result = yield* prompt.prompt({
            sessionID: session.id,
            agent: input.agent,
            model: input.model,
            variant: input.variant,
            parts: [{ type: "text", text: fixture.request }],
          })
          const assistant = result.info.role === "assistant" ? result.info : undefined
          const tokens = assistant?.tokens
          return {
            completed: assistant !== undefined,
            tokenUsage: tokens ? tokens.input + tokens.output + tokens.reasoning : 0,
            cost: assistant?.cost ?? 0,
            timeMs: Date.now() - startedAt,
          }
        }).pipe(Effect.ensuring(instances.disposeDirectory(workdir).pipe(Effect.ignore))),
      )
    })
}

export * as EvalSession from "./eval-session"
