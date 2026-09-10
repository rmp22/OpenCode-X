import { Context, Effect } from "effect"
import type { ClassifyOptions } from "@opencode-ai/llm/semantic"
import type { Provider } from "@/provider/provider"
import { LLMNative } from "@/session/llm/native-request"

type SemanticModel = ClassifyOptions["model"]

const currentModel = Context.Reference<SemanticModel | undefined>("ocx/semantic-runtime/model", {
  defaultValue: () => undefined,
})

export function options(): Effect.Effect<ClassifyOptions | undefined> {
  return Effect.service(currentModel).pipe(
    Effect.map((model) => (model ? { model } : undefined)),
  )
}

export function withProviderModel<A, E, R>(
  providerModel: Provider.Model,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    try {
      return effect.pipe(Effect.provideService(currentModel, LLMNative.model(providerModel)))
    } catch {
      // Unsupported provider adapters keep deterministic semantic fallbacks.
      return effect
    }
  })
}

export * as SemanticRuntime from "./semantic-runtime"
