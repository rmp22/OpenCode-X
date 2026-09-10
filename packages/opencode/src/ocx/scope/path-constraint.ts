import os from "node:os"
import path from "node:path"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

export type PathOperation = "read" | "write" | "execute"

export type PathConstraint = {
  readonly operation: PathOperation
  readonly root: string
  readonly allowOutside: boolean
  readonly source: "user"
}

export type PathDecision = {
  readonly allowed: boolean
  readonly operation: PathOperation
  readonly allowedRoot: string
  readonly target: string
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

const SCOPE_OUTSIDE = /(?:outside|outside of|outside the|outside your)\s+(?:the\s+)?(?:working directory|cwd)/i
const SCOPE_INSIDE = /(?:inside|within)(?:\s+(?:the|your))?\s+(?:working directory|cwd)/i
const SCOPE_MODIFIER = /(?:do not|don't|never|only|must not|without)\b[^.\n]{0,100}\b/i
const READ_VERBS = /(?:read|access|inspect|search|look)\b/i
const WRITE_VERBS =
  /(?:write|writes|writing|modify|modifies|modified|modifying|edit|edits|edited|editing|change|changes|changed|changing|create|creates|created|creating|delete|deletes|deleted|deleting|remove|removes|removed|removing|overwrite|overwrites|overwriting|overwritten)\b/i
const READ_SCOPE = new RegExp(SCOPE_MODIFIER.source + READ_VERBS.source, "i")
const WRITE_SCOPE = new RegExp(SCOPE_MODIFIER.source + WRITE_VERBS.source, "i")

export function compile(text: string, root: string): PathConstraint[] {
  if (!SCOPE_OUTSIDE.test(text) && !SCOPE_INSIDE.test(text)) return []
  const constraints: PathConstraint[] = []
  const resolved = path.resolve(root)
  if (READ_SCOPE.test(text)) {
    constraints.push({ operation: "read", root: resolved, allowOutside: false, source: "user" })
  }
  if (WRITE_SCOPE.test(text)) {
    constraints.push({ operation: "write", root: resolved, allowOutside: false, source: "user" })
  }
  return constraints
}

export function fromMessages(messages: readonly SessionV1.WithParts[], root: string): PathConstraint[] {
  const text = messages
    .filter((message) => message.info.role === "user")
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
  return compile(text, root)
}

export function authorize(
  constraints: readonly PathConstraint[],
  operation: PathOperation,
  target: string,
): PathDecision | undefined {
  const fullTarget = path.resolve(target)
  const constraint =
    constraints.find((item) => item.operation === operation && !item.allowOutside) ??
    (operation === "execute" ? constraints.find((item) => item.operation === "read" && !item.allowOutside) : undefined)
  if (!constraint) return undefined
  return {
    allowed: isInside(constraint.root, fullTarget),
    operation,
    allowedRoot: constraint.root,
    target: fullTarget,
  }
}

export function renderBlocked(decision: PathDecision): string {
  return [
    "SCOPE_BLOCKED",
    `operation=${decision.operation}`,
    `allowedRoot=${decision.allowedRoot}`,
    `target=${decision.target}`,
    "next=Perform the operation inside the working directory. Do not retry with a different parent, home, global config, or temporary path. If expected rules or files are outside allowedRoot, treat them as unavailable under the user's scope restriction.",
  ].join("\n")
}

export function readTargets(command: string, cwd: string): string[] {
  return command
    .split(/[;&|]/)
    .flatMap((segment) => segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [])
    .map((value) => value.replace(/^['"]|['"]$/g, ""))
    .filter((value) => value.length > 0 && !value.startsWith("-"))
    .filter((value) => path.isAbsolute(value) || value.startsWith(".") || value.startsWith("~") || value.includes("/") || value.includes("\\"))
    .map((value) => (value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : path.resolve(cwd, value)))
}

export function firstBlockedRead(
  constraints: readonly PathConstraint[],
  targets: readonly string[],
): PathDecision | undefined {
  return targets
    .map((target) => authorize(constraints, "read", target))
    .find((decision): decision is PathDecision => decision !== undefined && !decision.allowed)
}

export * as PathConstraint from "./path-constraint"
