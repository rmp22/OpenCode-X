import path from "node:path"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

export type ReadinessResult = {
  readonly ready: boolean
  readonly gaps: readonly string[]
  readonly inspectedPaths: readonly string[]
  readonly greenfield: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function inputOf(part: SessionV1.Part): Record<string, unknown> | undefined {
  if (part.type !== "tool") return undefined
  return record(part.state.input)
}

function outputOf(part: SessionV1.Part): string {
  if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return ""
  const state = part.state as unknown as Record<string, unknown>
  for (const key of ["output", "result", "error"]) {
    const value = state[key]
    if (typeof value === "string") return value
  }
  return ""
}

function completed(part: SessionV1.Part): boolean {
  return part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")
}

function target(input: Record<string, unknown>): string | undefined {
  for (const key of ["filePath", "path", "target"]) {
    if (typeof input[key] === "string" && input[key].trim()) return input[key].trim()
  }
  return undefined
}

function isRootTarget(value: string, workdir: string): boolean {
  return path.resolve(workdir, value) === path.resolve(workdir)
}

function isRootListing(part: SessionV1.Part, input: Record<string, unknown>, workdir: string): boolean {
  if (part.type !== "tool") return false
  const value = target(input)
  if (value && isRootTarget(value, workdir)) return true
  if (part.tool === "glob") {
    const base = typeof input.path === "string" ? input.path : typeof input.cwd === "string" ? input.cwd : workdir
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : ""
    return isRootTarget(base, workdir) && ["*", "**/*", "**"].includes(pattern)
  }
  if (part.tool === "bash" || part.tool === "shell") {
    const cmd = typeof input.command === "string" ? input.command.trim() : ""
    if (/\b(?:ls|dir)\b/.test(cmd)) return true
  }
  return false
}

function provesEmptyRoot(part: SessionV1.Part, input: Record<string, unknown>, workdir: string): boolean {
  if (!isRootListing(part, input, workdir)) return false
  const output = outputOf(part)
  if (!output) return false
  if (/No files found|0 entries|<entries>\s*<\/entries>|total\s+0|\b0\s+files\b|File not found|does not exist|ENOENT|not found/i.test(output)) return true
  const lines = output.trim().split("\n").filter((l) => l.trim().length > 0)
  const fileLines = lines.filter((l) => !/^total\s+\d+/i.test(l.trim()) && !/^\/(?:[^\s/]+\/?)+$/.test(l.trim()))
  if (fileLines.length > 0 && fileLines.every((l) => /\s\.\.?\s*$/.test(l.trim()))) return true
  return false
}

function searchedRules(part: SessionV1.Part, input: Record<string, unknown>, workdir: string): boolean {
  if (part.type !== "tool") return false
  const pattern = typeof input.pattern === "string" ? input.pattern : ""
  const value = target(input) ?? ""
  if (/(?:^|[/\\])(?:AGENTS|CONTEXT|OCX)\.md$/i.test(value)) return true
  if (part.tool === "glob" && /agents|context|ocx/i.test(pattern)) {
    const base = typeof input.path === "string" ? input.path : workdir
    return isRootTarget(base, workdir)
  }
  return false
}

export function inspect(messages: readonly SessionV1.WithParts[], workdir: string): ReadinessResult {
  const inspectedPaths: string[] = []
  let workdirInspected = false
  let rulesLoaded = false
  let relevantStructureInspected = false
  let greenfield = false
  let rootListingCompleted = false

  const userText = messages
    .filter((m) => m.info.role === "user")
    .flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")))
    .join(" ")
  if (/\b(?:create the directory|create a new|greenfield|work only inside)\b/i.test(userText)) {
    greenfield = true
    workdirInspected = true
    rootListingCompleted = true
    rulesLoaded = true
    relevantStructureInspected = true
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (!completed(part)) continue
      const input = inputOf(part)
      if (!input) continue
      const value = target(input)
      if (value) {
        inspectedPaths.push(value)
        const isRoot = isRootTarget(value, workdir)
        workdirInspected ||= isRoot
        rulesLoaded ||= /(?:^|[/\\])(?:agents|context|ocx)\.md$/i.test(value)
        const out = outputOf(part)
        if (isRoot && /File not found|does not exist|ENOENT|not found/i.test(out)) {
          greenfield = true
          workdirInspected = true
          rootListingCompleted = true
          rulesLoaded = true
          relevantStructureInspected = true
        }
      }
      if (isRootListing(part, input, workdir)) {
        workdirInspected = true
        rootListingCompleted = true
      }
      greenfield ||= provesEmptyRoot(part, input, workdir)
      rulesLoaded ||= searchedRules(part, input, workdir)
      if (
        part.type === "tool" &&
        (["read", "glob", "grep", "codebase", "ocx_context"].includes(part.tool) ||
          ((part.tool === "bash" || part.tool === "shell") &&
            /\b(?:ls|dir|find|pwd)\b/.test(typeof input.command === "string" ? input.command : "")))
      )
        relevantStructureInspected = true
    }
  }

  if (rootListingCompleted && greenfield) rulesLoaded = true
  if (greenfield) relevantStructureInspected = true

  const gaps = [
    ...(workdirInspected ? [] : ["inspect the working directory"]),
    ...(rulesLoaded ? [] : ["load applicable repository rules or confirm none exist"]),
    ...(relevantStructureInspected ? [] : ["inspect relevant existing structure or confirm the workdir is empty"]),
  ]
  return {
    ready: gaps.length === 0,
    gaps,
    inspectedPaths: [...new Set(inspectedPaths)],
    greenfield,
  }
}

export function isContextReady(messages: readonly SessionV1.WithParts[], workdir: string): boolean {
  return inspect(messages, workdir).ready
}

export function contextReadinessGaps(messages: readonly SessionV1.WithParts[], workdir: string): string[] {
  return [...inspect(messages, workdir).gaps]
}

export * as ContextReadiness from "./readiness"
