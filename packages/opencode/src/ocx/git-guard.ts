import type { Item } from "@/git"

export type Operation =
  | "stage"
  | "restore"
  | "checkout"
  | "switch"
  | "reset"
  | "clean"
  | "stash"
  | "commit"
  | "merge"
  | "rebase"
  | "cherry_pick"
  | "revert"
  | "apply"
  | "push"

export type Command = {
  readonly operation: Operation
  readonly args: readonly string[]
  readonly broad: boolean
  readonly destructive: boolean
  readonly force: boolean
  readonly paths: readonly string[]
}

export type Workspace = {
  readonly known: boolean
  readonly entries: readonly Item[]
}

export type Decision = {
  readonly action: "REQUIRE_PERMISSION" | "BLOCK"
  readonly permission: "git" | "git_hunk" | "git_dirty_workspace" | "git_destructive" | "git_force_push"
  readonly reason: string
  readonly recommendation: string
}

const MUTATING = new Set<Operation>([
  "stage",
  "restore",
  "checkout",
  "switch",
  "reset",
  "clean",
  "stash",
  "commit",
  "merge",
  "rebase",
  "cherry_pick",
  "revert",
  "apply",
  "push",
])

function segments(command: string): string[] {
  const result: string[] = []
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (!";&|\n".includes(char)) continue
    result.push(command.slice(start, index))
    if ((char === "&" || char === "|") && command[index + 1] === char) index++
    start = index + 1
  }
  result.push(command.slice(start))
  return result.map((item) => item.trim()).filter(Boolean)
}

function tokens(segment: string): string[] {
  return segment.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g)?.map((item) => item.replace(/^(['"])(.*)\1$/s, "$2")) ?? []
}

function gitArgs(segment: string): string[] | undefined {
  const values = tokens(segment)
  const index = values.findIndex((value) => /^git(?:\.exe)?$/i.test(value))
  if (index < 0) return undefined
  return values.slice(index + 1)
}

function pathArguments(args: readonly string[]): string[] {
  const separator = args.indexOf("--")
  const values = separator >= 0 ? args.slice(separator + 1) : args.slice(1)
  return values.filter((value) => !value.startsWith("-"))
}

export function classify(command: string): Command | undefined {
  for (const segment of segments(command)) {
    const args = gitArgs(segment)
    if (!args || args.length === 0) continue
    const operation = args[0].toLowerCase()
    if (operation === "add") {
      const broad = args.some(
        (value) =>
          value === "." ||
          value === "./" ||
          value === "-A" ||
          value === "--all" ||
          value === "-u" ||
          value === "--update",
      )
      return { operation: "stage", args, broad, destructive: false, force: false, paths: pathArguments(args) }
    }
    if (operation === "restore") {
      const broad = args.some((value) => value === "." || value === "./" || value === ":/")
      return { operation: "restore", args, broad, destructive: broad, force: false, paths: pathArguments(args) }
    }
    if (operation === "checkout") {
      const separator = args.indexOf("--")
      const broad =
        separator >= 0 && args.slice(separator + 1).some((value) => value === "." || value === "./" || value === ":/")
      const branchSwitch = separator < 0 && args.slice(1).some((value) => !value.startsWith("-"))
      return {
        operation: branchSwitch ? "checkout" : "restore",
        args,
        broad,
        destructive: broad,
        force: false,
        paths: pathArguments(args),
      }
    }
    if (operation === "switch") {
      return { operation: "switch", args, broad: false, destructive: false, force: false, paths: pathArguments(args) }
    }
    if (operation === "reset") {
      const destructive = args.includes("--hard") || args.includes("--merge") || args.includes("--keep")
      const broad = destructive || args.some((value) => value === "." || value === "./" || value === ":/")
      return { operation: "reset", args, broad, destructive, force: false, paths: pathArguments(args) }
    }
    if (operation === "clean") {
      return { operation: "clean", args, broad: true, destructive: true, force: false, paths: pathArguments(args) }
    }
    if (operation === "stash") {
      return { operation: "stash", args, broad: true, destructive: true, force: false, paths: pathArguments(args) }
    }
    if (operation === "commit") {
      const broad = args.includes("-a") || args.includes("--all")
      return { operation: "commit", args, broad, destructive: false, force: false, paths: pathArguments(args) }
    }
    if (operation === "merge" || operation === "rebase" || operation === "cherry-pick" || operation === "revert") {
      const normalized = operation === "cherry-pick" ? "cherry_pick" : operation
      return { operation: normalized, args, broad: false, destructive: false, force: false, paths: pathArguments(args) }
    }
    if (operation === "apply") {
      return { operation: "apply", args, broad: false, destructive: false, force: false, paths: pathArguments(args) }
    }
    if (operation === "push") {
      const force = args.some((value) => value === "-f" || value === "--force" || value === "--force-with-lease")
      return { operation: "push", args, broad: false, destructive: force, force, paths: pathArguments(args) }
    }
  }
  return undefined
}

export function parseStatus(value: string): Item[] {
  const result: Item[] = []
  const parts = value.split("\0").filter(Boolean)
  for (const part of parts) {
    if (part.length < 4) continue
    const code = part.slice(0, 2)
    const file = part.slice(3)
    if (!file) continue
    result.push({ file, code, status: gitStatus(code) })
  }
  return result
}

export function evaluate(command: Command | undefined, workspace: Workspace): Decision | undefined {
  if (!command || !MUTATING.has(command.operation)) return undefined
  const dirty = !workspace.known || workspace.entries.length > 0

  if (command.operation === "restore" && command.broad) {
    return blocked("broad restore or checkout would discard user work", "restore only an exact agent-owned hunk")
  }
  if (command.operation === "stage" && command.broad) {
    if (dirty)
      return blocked("broad staging may include unrelated user work", "stage exact agent-owned hunks with git add -p")
    return required("git", "broad staging still needs explicit approval", "stage exact paths or hunks")
  }
  if (command.operation === "stage" && dirty && hasExistingPath(command.paths, workspace.entries)) {
    return blocked(
      "the staged path may contain pre-existing or mixed user work",
      "stage only agent-owned hunks with git add -p",
    )
  }
  if (command.operation === "commit" && command.broad) {
    return blocked(
      "git commit -a can include unrelated changes",
      "stage reviewed agent-owned hunks and commit exact paths",
    )
  }
  if (command.operation === "reset" && command.destructive) {
    return required(
      "git_destructive",
      "hard or merge reset can discard local work",
      "use an exact hunk operation when possible",
    )
  }
  if (command.operation === "clean" || command.operation === "stash") {
    return required(
      "git_destructive",
      `${command.operation} changes shared workspace state`,
      "inspect a dry run and request separate authorization",
    )
  }
  if ((command.operation === "checkout" || command.operation === "switch") && dirty) {
    return required(
      "git_dirty_workspace",
      "branch switching with local changes may overwrite or carry user work",
      "keep the current branch or request explicit approval",
    )
  }
  if (command.operation === "push" && command.force) {
    return required(
      "git_force_push",
      "force push rewrites remote history",
      "use a normal push or request explicit force-push authorization",
    )
  }
  return required(
    "git",
    "Git mutation requires workspace-aware approval",
    "inspect the status and operate on exact paths or hunks",
  )
}

function hasExistingPath(paths: readonly string[], entries: readonly Item[]): boolean {
  if (paths.length === 0) return true
  return paths.some((file) => entries.some((entry) => entry.file === file))
}

function gitStatus(code: string): Item["status"] {
  if (code === "??") return "added"
  if (code.includes("U")) return "modified"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

function required(permission: Decision["permission"], reason: string, recommendation: string): Decision {
  return { action: "REQUIRE_PERMISSION", permission, reason, recommendation }
}

function blocked(reason: string, recommendation: string): Decision {
  return { action: "BLOCK", permission: "git_hunk", reason, recommendation }
}

export * as GitGuard from "./git-guard"
