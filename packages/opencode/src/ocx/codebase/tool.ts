import { Effect, Schema } from "effect"
import { define, type Context } from "@/tool/tool"
import { InstanceState } from "@/effect/instance-state"
import { Codebase } from "./service"

const MAX_OUTPUT_BYTES = 30_000

const OPERATIONS = [
  "get_repository_profile",
  "get_repository_map",
  "lookup_file",
  "lookup_path",
  "lookup_module",
  "lookup_tests",
  "list_module_files",
  "list_source_roots",
  "list_related_modules",
  "get_working_set",
  "plan_search",
  "history",
] as const

export const Parameters = Schema.Struct({
  operation: Schema.Literals(OPERATIONS).annotate({ description: "Codebase intelligence operation" }),
  query: Schema.optional(Schema.String).annotate({ description: "File name, path fragment, module, or search query" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Maximum number of returned records" }),
})

export const CodebaseTool = define(
  "ocx_codebase",
  Effect.gen(function* () {
    const codebase = yield* Codebase.Service
    return {
      description:
        "Inspect bounded repository intelligence before broad exploration. Query the profile, module map, path index, working set, search plan, and search history.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "read",
            patterns: ["codebase"],
            always: ["codebase"],
            metadata: { operation: params.operation },
          })
          const limit = normalizeLimit(params.limit)
          const query = params.query?.trim() ?? ""
          const result = yield* execute(params.operation, query, limit, ctx.sessionID)
          const serialized = JSON.stringify(result, null, 2) ?? "{}"
          const bytes = Buffer.from(serialized, "utf8")
          const truncated = bytes.length > MAX_OUTPUT_BYTES
          const output = truncated
            ? `${bytes.subarray(0, MAX_OUTPUT_BYTES).toString("utf8")}\n...output truncated...`
            : serialized
          return {
            title: `Codebase: ${params.operation}`,
            metadata: { operation: params.operation, query, truncated },
            output,
          }
        }).pipe(Effect.orDie),
    }

    function execute(
      operation: Schema.Schema.Type<typeof Parameters>["operation"],
      query: string,
      limit: number,
      sessionID: string,
    ) {
      if (operation === "get_repository_profile") return codebase.profile()
      if (operation === "get_repository_map") return codebase.map()
      if (operation === "lookup_file") return codebase.lookupFile(requireQuery(operation, query), limit)
      if (operation === "lookup_path") return codebase.lookupPath(requireQuery(operation, query), limit)
      if (operation === "lookup_module") return codebase.lookupModule(requireQuery(operation, query))
      if (operation === "lookup_tests") return codebase.lookupTests(requireQuery(operation, query), limit)
      if (operation === "list_module_files") return codebase.listModuleFiles(requireQuery(operation, query), limit)
      if (operation === "list_source_roots")
        return codebase.profile().pipe(Effect.map((profile) => profile.sourceRoots.slice(0, limit)))
      if (operation === "list_related_modules") return codebase.relatedModules(requireQuery(operation, query))
      if (operation === "get_working_set") return codebase.workingSet(sessionID)
      if (operation === "history") return codebase.history().pipe(Effect.map((records) => records.slice(0, limit)))
      return Effect.gen(function* () {
        const instance = yield* InstanceState.context
        return yield* codebase
          .prepareSearch({
            kind: "grep",
            sessionID,
            query: requireQuery(operation, query),
            cwd: instance.directory,
            scopeExplicit: false,
          })
          .pipe(
            Effect.map((prepared) => ({
              intent: prepared.plan.intent,
              candidates: prepared.plan.candidates,
              selected: prepared.plan.selected,
              route: prepared.route,
              decision: prepared.decision,
            })),
          )
      })
    }
  }),
)

function requireQuery(operation: string, query: string): string {
  if (query) return query
  throw new Error(`${operation} requires query`)
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return 100
  return Math.min(value, 1_000)
}

export * as CodebaseToolModule from "./tool"
