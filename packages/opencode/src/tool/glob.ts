import path from "path"
import { Effect, Option, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Codebase } from "@/ocx/codebase/service"
import { CodebaseSearch } from "@/ocx/codebase/search"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
})

type Metadata = {
  count: number
  truncated: boolean
  scope?: string
  route?: string
}

export const GlobTool = Tool.define<typeof Parameters, Metadata, FSUtil.Service | Ripgrep.Service>(
  "glob",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const codebase = Option.getOrUndefined(yield* Effect.serviceOption(Codebase.Service))
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          let search = params.path ?? ins.directory
          search = path.isAbsolute(search) ? search : path.resolve(ins.directory, search)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: false,
            kind: "directory",
          })

          if (!codebase) {
            const limit = 100
            yield* ctx.ask({
              permission: "glob",
              patterns: [params.pattern],
              always: ["*"],
              metadata: {
                pattern: params.pattern,
                path: params.path,
              },
            })
            const files = yield* ripgrep.glob({ cwd: search, pattern: params.pattern, limit })
            const truncated = files.length === limit
            const output = []
            if (files.length === 0) output.push("No files found")
            if (files.length > 0) {
              output.push(...files.map((file) => path.resolve(search, file.path)))
              if (truncated) {
                output.push("")
                output.push(
                  `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
                )
              }
            }
            return {
              title: path.relative(ins.worktree, search),
              metadata: { count: files.length, truncated },
              output: output.join("\n"),
            }
          }

          const prepared = yield* codebase.prepareSearch({
            kind: "glob",
            sessionID: ctx.sessionID,
            query: params.pattern,
            cwd: search,
            scopeExplicit: params.path !== undefined,
            explicitRepositoryWide: explicitRepositoryWide(ctx, ins.worktree, search),
          })
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
              scope: prepared.scope,
              route: prepared.route.family,
            },
          })
          const result = yield* codebase.runGlob(prepared, ctx.abort)
          const files = result.items
          const truncated = result.truncated

          const output = []
          if (files.length === 0) output.push("No files found")
          if (files.length > 0) {
            output.push(...files.map((file) => path.resolve(prepared.scope, file.path)))
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${files.length} results. Consider using a more specific path or pattern.)`,
              )
            }
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
              scope: prepared.scope,
              route: prepared.route.family,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function explicitRepositoryWide(ctx: Tool.Context, worktree: string, search: string): boolean {
  if (path.resolve(worktree) === path.resolve(search)) return true
  return ctx.messages.some(
    (message) =>
      message.info.role === "user" &&
      message.parts.some((part) => part.type === "text" && CodebaseSearch.explicitFullSearch(part.text)),
  )
}
