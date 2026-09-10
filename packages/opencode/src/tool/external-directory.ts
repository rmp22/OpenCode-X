import path from "path"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { containsPath } from "../project/instance-context"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { PathConstraint, type PathOperation } from "@/ocx/scope/path-constraint"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
  operation?: PathOperation
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return false
  const ins = yield* InstanceState.context
  if (options?.bypass && PathConstraint.fromMessages(ctx.messages, ins.directory).length === 0) return false
  const full = process.platform === "win32" ? FSUtil.normalizePath(target) : target
  const decision = PathConstraint.authorize(PathConstraint.fromMessages(ctx.messages, ins.directory), options?.operation ?? "read", full)
  if (decision && !decision.allowed) return yield* Effect.die(new Error(PathConstraint.renderBlocked(decision)))
  if (options?.bypass) return false
  if (containsPath(full, ins)) return false

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
  return true
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options))
}
