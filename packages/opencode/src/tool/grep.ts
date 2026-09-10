import path from "path"
import { Effect, Option, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Codebase } from "@/ocx/codebase/service"
import { CodebaseSearch } from "@/ocx/codebase/search"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
})

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const codebase = Option.getOrUndefined(yield* Effect.serviceOption(Codebase.Service))
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string; include?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const empty = {
            title: params.pattern,
            metadata: { matches: 0, truncated: false },
            output: "No files found",
          }
          if (!params.pattern) {
            throw new Error("pattern is required")
          }

          const ins = yield* InstanceState.context
          const requested = path.isAbsolute(params.path ?? ins.directory)
            ? (params.path ?? ins.directory)
            : path.join(ins.directory, params.path ?? ".")
          const requestedInfo = yield* fs.stat(requested).pipe(Effect.catch(() => Effect.succeed(undefined)))
          yield* assertExternalDirectoryEffect(ctx, requested, {
            bypass: false,
            kind: requestedInfo?.type === "Directory" ? "directory" : "file",
          })

          const search = FSUtil.resolve(requested)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const cwd = info?.type === "Directory" ? search : path.dirname(search)
          if (!codebase) {
            yield* ctx.ask({
              permission: "grep",
              patterns: [params.pattern],
              always: ["*"],
              metadata: {
                pattern: params.pattern,
                path: params.path,
                include: params.include,
              },
            })
            const result = yield* ripgrep.grep({
              cwd,
              pattern: params.pattern,
              include: params.include,
              limit: 100,
            })
            if (result.length === 0) return empty
            const rows = result.map((item) => ({
              path: path.resolve(
                requestedInfo?.type === "Directory" ? requested : path.dirname(requested),
                item.entry.path,
              ),
              line: item.line,
              text: item.text,
            }))
            const truncated = rows.length === 100
            const total = rows.length
            const hasMore = truncated || result.length === 100
            const output = [`Found ${total} matches${hasMore ? " (more matches available)" : ""}`]
            let current = ""
            for (const match of rows) {
              if (current !== match.path) {
                if (current !== "") output.push("")
                current = match.path
                output.push(`${match.path}:`)
              }
              output.push(`  Line ${match.line}: ${match.text}`)
            }
            if (truncated) {
              output.push("")
              output.push("(Results truncated. Consider using a more specific path or pattern.)")
            }
            return {
              title: params.pattern,
              metadata: { matches: total, truncated },
              output: output.join("\n"),
            }
          }
          const prepared = yield* codebase.prepareSearch({
            kind: "grep",
            sessionID: ctx.sessionID,
            query: params.pattern,
            cwd,
            include: params.include,
            scopeExplicit: params.path !== undefined,
            explicitRepositoryWide: explicitRepositoryWide(ctx, ins.worktree, cwd),
          })
          yield* ctx.ask({
            permission: "grep",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
              include: params.include,
              scope: prepared.scope,
              route: prepared.route.family,
            },
          })
          const result = yield* codebase.runGrep(prepared, ctx.abort)
          if (result.items.length === 0) return empty

          const rows = result.items.map((item) => ({
            path: path.resolve(prepared.scope, item.entry.path),
            line: item.line,
            text: item.text,
          }))

          const truncated = result.truncated
          const final = rows
          if (final.length === 0) return empty

          const total = rows.length
          const hasMore = truncated || result.items.length === result.decision.budget.maxResults
          const output = [`Found ${total} matches${hasMore ? " (more matches available)" : ""}`]

          let current = ""
          for (const match of final) {
            if (current !== match.path) {
              if (current !== "") output.push("")
              current = match.path
              output.push(`${match.path}:`)
            }
            output.push(`  Line ${match.line}: ${match.text}`)
          }

          if (truncated) {
            output.push("")
            output.push("(Results truncated. Consider using a more specific path or pattern.)")
          }

          return {
            title: params.pattern,
            metadata: {
              matches: total,
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
