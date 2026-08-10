export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const PROJECT_DIRECTORY = ".ocx"

export function globalDirectory() {
  return Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config
}

export function isGlobalDirectory(dir: string) {
  return path.resolve(dir) === path.resolve(globalDirectory())
}

export function isManagedDirectory(dir: string) {
  const normalized = path.resolve(dir)
  return (
    path.basename(normalized) === PROJECT_DIRECTORY ||
    isGlobalDirectory(normalized)
  )
}

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  const globalDir = globalDirectory()
  return unique([
    globalDir,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
        ? (yield* afs.up({
            targets: [PROJECT_DIRECTORY],
            start: directory,
            stop: worktree,
          })).toReversed()
      : []),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
