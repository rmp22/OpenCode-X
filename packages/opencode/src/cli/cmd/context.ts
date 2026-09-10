import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Codebase } from "@/ocx/codebase/service"
import { ContextCommandService, CONTEXT_OPERATION_VALUES } from "@/ocx/context/commands"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"

export type ContextCommandArgs = {
  readonly operation: string
  readonly scope?: string
  readonly confirm?: boolean
}

export const ContextCommand = effectCmd({
  command: "context <operation> [scope]",
  describe: "inspect or update persistent repository context",
  builder: (yargs) =>
    yargs
      .positional("operation", {
        describe: "context operation",
        type: "string",
        choices: [...CONTEXT_OPERATION_VALUES, "explore"],
      })
      .positional("scope", {
        describe: "scope, query, or exact repository ID",
        type: "string",
      })
      .option("confirm", {
        describe: "confirm deletion for forget",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.context")(function* (args) {
    const flags = yield* RuntimeFlags.Service
    if (!flags.contextEnabled) {
      UI.println("Context is disabled. Continue with the codebase mapper and targeted exploration.")
      return
    }
    const instance = yield* InstanceState.context
    const command =
      args.operation === "explore"
        ? `/explore_codebase ${args.scope ?? "full"}`
        : `/context ${args.operation}${args.scope ? ` ${args.scope}` : ""}`
    const mapper =
      args.operation === "explore"
        ? yield* Effect.gen(function* () {
            const codebase = yield* Codebase.Service
            const profile = yield* codebase.profile()
            const map = yield* codebase.map()
            return { profile, map, ...(profile.sourceRevision ? { revision: profile.sourceRevision } : {}) }
          })
        : undefined
    const result = ContextCommandService.execute({
      root: instance.worktree,
      command,
      ...(mapper ? { mapper } : {}),
      confirmForget: args.confirm === true,
      taskID: `cli-${Date.now()}`,
    })
    UI.println(result.text)
  }),
})
