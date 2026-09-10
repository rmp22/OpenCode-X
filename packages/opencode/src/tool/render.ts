import { Effect, Schema } from "effect"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { RenderOracle } from "@/ocx/render-oracle"
import DESCRIPTION from "./render.txt"

export const Parameters = Schema.Struct({
  entry: Schema.NonEmptyString,
  css: Schema.optional(Schema.String),
})

type Metadata = {
  shots: string[]
  waitMs: number
  findings: string[]
}

export const RenderTool = Tool.define<typeof Parameters, Metadata, never>(
  "ocx_render",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instanceCtx = yield* InstanceState.context
          const cwd = instanceCtx.directory
          const entryFile = params.entry.startsWith("file:") ? params.entry : `file://${join(cwd, params.entry)}`
          const css = params.css ?? ""
          const plan = RenderOracle.planRender(params.entry, css, [params.entry]) ?? {
            entry: params.entry,
            viewports: [375, 768, 1440],
            waitMs: 1200,
            asserts: [] as readonly string[],
          }
          const outDir = join(tmpdir(), `ocx-render-${ctx.sessionID.replace(/[^A-Za-z0-9_-]/g, "")}`)
          const captures = yield* Effect.tryPromise({
            try: () => RenderOracle.captureStatic(entryFile, outDir, plan.viewports),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }).pipe(Effect.orDie)
          const findings = RenderOracle.evaluateCaptures(captures)
          const shots = captures.flatMap((capture) => (capture.shotPath ? [capture.shotPath] : []))
          return {
            title: shots.length > 0 ? `Rendered ${shots.length} viewport(s)` : "Render unavailable",
            output: [
              "RENDER ORACLE",
              `entry: ${params.entry}`,
              `waitMs: ${plan.waitMs}`,
              ...captures.map((capture) =>
                capture.shotPath
                  ? `- viewport ${capture.viewport}: ${capture.shotPath}`
                  : `- viewport ${capture.viewport}: UNAVAILABLE (${capture.unavailable ?? "unknown"})`,
              ),
              ...findings.map((finding) => `! ${finding.id}: ${finding.message}`),
              shots.length === 0 ? "Report visual status as UNVERIFIED." : "Cite the shot paths as visual evidence.",
            ].join("\n"),
            metadata: { shots, waitMs: plan.waitMs, findings: findings.map((finding) => finding.id) },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
