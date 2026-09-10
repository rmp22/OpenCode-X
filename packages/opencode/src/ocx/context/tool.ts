export * as ContextToolModule from "./tool"

import { Effect, Schema } from "effect"
import path from "node:path"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { define, type Context } from "@/tool/tool"
import { Codebase } from "../codebase/service"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CONTEXT_OPERATION_VALUES, ContextCommandService } from "./commands"
import { ContextExploration } from "./exploration"

const TOOL_OPERATION_VALUES = [...CONTEXT_OPERATION_VALUES, "explore"] as const

export const Parameters = Schema.Struct({
  operation: Schema.Literals(TOOL_OPERATION_VALUES).annotate({ description: "Context operation to perform" }),
  scope: Schema.optional(Schema.String).annotate({
    description: "Repository-relative scope, pipeline, or exact repository ID",
  }),
  query: Schema.optional(Schema.String).annotate({ description: "Search text for the context query" }),
  confirm: Schema.optional(Schema.Boolean).annotate({ description: "Confirm deletion for the forget operation" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Maximum output characters" }),
  findings: Schema.optional(Schema.Array(Schema.Unknown)).annotate({
    description: "Validated structured findings from explicit exploration",
  }),
})

export const ContextTool = define(
  "ocx_context",
  Effect.gen(function* () {
    const codebase = yield* Codebase.Service
    const fs = yield* FSUtil.Service
    const flags = yield* RuntimeFlags.Service
    return {
      description:
        "Inspect and update persistent source-backed repository context. Use explore for deliberate mapper-backed exploration; context updates are transactional and bounded.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Context) =>
        Effect.gen(function* () {
          const permission = params.operation === "forget" || params.operation === "refresh" ? "edit" : "read"
          yield* ctx.ask({
            permission,
            patterns: ["context"],
            always: ["context"],
            metadata: { operation: params.operation },
          })
          if (!flags.contextEnabled)
            return {
              title: `Context: ${params.operation}`,
              metadata: { operation: params.operation, changed: false, disabled: true },
              output: "Context is disabled. Continue with the codebase mapper and targeted exploration.",
            }
          const instance = yield* InstanceState.context
          const scope = params.query?.trim() || params.scope?.trim() || ""
          const input =
            params.operation === "explore"
              ? {
                  command: `/explore_codebase ${scope || "full"}`,
                  mapper: yield* mapper(codebase, fs, scope),
                  findings: params.findings?.slice(0, 64).flatMap((item) => {
                    const parsed = ContextExploration.parseFinding(item, instance.worktree)
                    return parsed.valid ? [parsed.finding] : []
                  }),
                }
              : { command: `/context ${params.operation}${scope ? ` ${scope}` : ""}` }
          const result = ContextCommandService.execute({
            root: instance.worktree,
            command: input.command,
            ...("mapper" in input ? { mapper: input.mapper } : {}),
            ...("findings" in input && input.findings ? { findings: input.findings } : {}),
            confirmForget: params.confirm === true,
            taskID: `tool-${ctx.sessionID}-${ctx.messageID}`,
          })
          const output = params.limit ? result.text.slice(0, normalizeLimit(params.limit)) : result.text
          return {
            title: `Context: ${params.operation}`,
            metadata: {
              operation: params.operation,
              changed: result.changed,
              disabled: false,
              repositoryID: result.repositoryID,
              ...(result.confirmationRequired ? { confirmationRequired: true } : {}),
            },
            output,
          }
        }).pipe(Effect.orDie),
    }

    function mapper(service: Codebase.Interface, filesystem: FSUtil.Interface, scope: string) {
      return Effect.gen(function* () {
        const profile = yield* service.profile()
        const map = yield* service.map()
        const roots = scope && scope !== "full" ? [scope] : profile.samplePaths
        const sources = yield* Effect.forEach(
          profile.samplePaths
            .filter((file) => roots.some((root) => file === root || file.startsWith(`${root}/`)))
            .slice(0, 96),
          (file) =>
            filesystem.readFileStringSafe(path.resolve(profile.root, file)).pipe(
              Effect.orDie,
              Effect.map((content) => (content === undefined ? undefined : { file, content })),
            ),
          { concurrency: 4 },
        )
        return {
          profile,
          map,
          sources: sources.filter((source): source is { file: string; content: string } => source !== undefined),
          ...(profile.sourceRevision ? { revision: profile.sourceRevision } : {}),
        }
      })
    }
  }),
)

function normalizeLimit(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 30_000) : 30_000
}
