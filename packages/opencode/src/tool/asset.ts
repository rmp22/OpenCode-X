import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { AssetPipeline } from "@/ocx/asset-pipeline"
import DESCRIPTION from "./asset.txt"

const Entry = Schema.Struct({
  url: Schema.NonEmptyString,
  dest: Schema.NonEmptyString,
  alt: Schema.NonEmptyString,
  maxKB: Schema.optional(Schema.Number),
})

export const Parameters = Schema.Struct({
  manifest: Schema.NonEmptyArray(Entry),
  concurrency: Schema.optional(Schema.Number),
})

type Metadata = {
  downloaded: number
  skipped: number
  bytes: number
  manifest: string
}

export const AssetTool = Tool.define<typeof Parameters, Metadata, never>(
  "ocx_asset",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const instanceCtx = yield* InstanceState.context
          const cwd = instanceCtx.directory
          const entries = params.manifest.map((entry) => ({
            url: entry.url,
            dest: entry.dest,
            alt: entry.alt,
            ...(entry.maxKB !== undefined ? { maxKB: entry.maxKB } : {}),
          }))
          const results = yield* Effect.tryPromise({
            try: () => AssetPipeline.fetchAssets(entries, cwd, { ...(params.concurrency !== undefined ? { concurrency: params.concurrency } : {}) }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }).pipe(Effect.orDie)
          const downloaded = results.filter((result) => !result.skipped).length
          const bytes = results.reduce((total, result) => total + result.bytes, 0)
          return {
            title: `Fetched ${downloaded} assets (${results.length - downloaded} cached)`,
            output: [
              "ASSET MANIFEST",
              ...results.map((result) => `- ${result.dest} ${result.bytes}b sha256:${result.sha256.slice(0, 12)} ${result.skipped ? "(cached)" : "(downloaded)"} alt="${result.alt}"`),
              "Evidence: assets/manifest.json",
            ].join("\n"),
            metadata: { downloaded, skipped: results.length - downloaded, bytes, manifest: "assets/manifest.json" },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
