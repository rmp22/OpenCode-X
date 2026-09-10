import { readFileSync } from "node:fs"
import { Effect } from "effect"
import { isRecord } from "@/util/record"
import { Rails } from "./rails"

const MUTATION_TOOLS = new Set(["edit", "write", "multiedit"])

export function syntaxFeedback(input: {
  readonly enabled: boolean
  readonly toolID: string
  readonly args: unknown
}): Effect.Effect<string | undefined, unknown> {
  if (!input.enabled || !MUTATION_TOOLS.has(input.toolID)) return Effect.succeed(undefined)
  const filePath = filePathFrom(input.args)
  if (!filePath) return Effect.succeed(undefined)
  return Effect.try({
    try: () => Rails.syntaxRail(filePath, readFileSync(filePath, "utf8")),
    catch: () => undefined,
  })
}

function filePathFrom(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined
  if (typeof args.filePath === "string") return args.filePath
  return typeof args.file_path === "string" ? args.file_path : undefined
}

export * as OCXToolRail from "./tool-rail"
