import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { Strategy } from "@/ocx/strategy"
import DESCRIPTION from "./strategy.txt"

const StrategyName = Schema.Literals(Strategy.STRATEGY_NAMES)

export const Parameters = Schema.Struct({
  names: Schema.optional(
    Schema.NonEmptyArray(StrategyName).annotate({
      description: "The exact strategy names to load together from the strategy catalog",
    }),
  ),
  name: Schema.optional(
    StrategyName.annotate({
      description: "The exact name of one strategy document from the strategy catalog",
    }),
  ),
})

type Metadata = {
  strategies: Strategy.StrategyName[]
}

export const StrategyTool = Tool.define<typeof Parameters, Metadata, never>(
  "strategy",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const names = [...new Set(params.names ?? (params.name ? [params.name] : []))]
          if (names.length === 0) {
            return {
              title: "No strategies selected",
              output: "Pass a strategy name or a non-empty names array.",
              metadata: { strategies: names },
            }
          }
          const documents = names.map((name) => ({ name, content: Strategy.load(name)?.trim() }))
          const missing = documents.find((document) => document.content === undefined)
          if (missing) {
            return {
              title: `Unknown strategy: ${missing.name}`,
              output: `Strategy "${missing.name}" does not exist.`,
              metadata: { strategies: names },
            }
          }

          return {
            title: `Loaded strategies: ${names.join(", ")}`,
            output: documents
              .map((document) =>
                [`<strategy_content name="${document.name}">`, document.content, "</strategy_content>"].join("\n"),
              )
              .join("\n\n"),
            metadata: { strategies: names },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
