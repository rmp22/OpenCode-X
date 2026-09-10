import path from "node:path"
import os from "node:os"
import type { Effect as WorkflowEffect } from "./workflow-gate/types"

const SEARCH_COMMANDS = new Set(["grep", "egrep", "fgrep", "find", "fd"])
const READ_COMMANDS = new Set([
  "cat",
  "dir",
  "du",
  "fd",
  "file",
  "get-content",
  "find",
  "grep",
  "egrep",
  "fgrep",
  "head",
  "less",
  "ls",
  "more",
  "rg",
  "stat",
  "tail",
  "type",
  "wc",
  "select-string",
])
const SAFE_COMMANDS = new Set([
  "cd",
  "command",
  "echo",
  "exit",
  "false",
  "printf",
  "pwd",
  "sleep",
  "test",
  "true",
  "which",
  "where",
  "set-location",
  "write-host",
  "write-output",
])
const FILE_MUTATION_COMMANDS = new Set([
  "chmod",
  "chown",
  "cp",
  "copy",
  "copy-item",
  "del",
  "erase",
  "install",
  "mkdir",
  "md",
  "move",
  "move-item",
  "mv",
  "new-item",
  "rd",
  "ren",
  "rename",
  "rename-item",
  "remove-item",
  "rm",
  "rmdir",
  "sed",
  "set-content",
  "add-content",
  "out-file",
  "tee",
  "touch",
  "truncate",
])
const GIT_READ_COMMANDS = new Set([
  "branch",
  "check-ref-format",
  "describe",
  "diff",
  "grep",
  "log",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "shortlog",
  "show",
  "status",
  "tag",
  "version",
])
const GIT_MUTATION_COMMANDS = new Set([
  "add",
  "am",
  "apply",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "rebase",
  "reset",
  "restore",
  "revert",
  "stash",
  "switch",
  "update-index",
  "push",
])
const PACKAGE_COMMANDS = new Set([
  "apt",
  "apt-get",
  "apk",
  "brew",
  "bun",
  "cargo",
  "dnf",
  "npm",
  "pacman",
  "pip",
  "pip3",
  "pnpm",
  "python",
  "python3",
  "yarn",
])
const INTERPRETERS = new Set(["node", "nodejs", "perl", "python", "python2", "python3", "ruby"])
const DOWNLOAD_COMMANDS = new Set(["curl", "wget"])
const GIT_OPTIONS_WITH_VALUES = new Set(["-c", "--config-env", "--git-dir", "--namespace", "--work-tree"])
const SAFE_PACKAGE_COMMANDS = new Set(["info", "list", "ls", "outdated", "root", "version", "view", "why", "test", "typecheck"])
const TEST_COMMANDS = new Set(["pytest", "jest", "vitest", "mocha", "ava", "ctest", "tox"])
const SPECIAL_RG_FLAGS =
  /(?:^|\s)(?:-c|--count|-U|--multiline|--pcre2|--json|--stats|--files|--files-with-matches|--files-without-match)(?:\s|=|$)/
const SPECIAL_GREP_FLAGS = /(?:^|\s)(?:-c|--count)(?:\s|=|$)/

export type Rule = {
  readonly rule: "tool-search" | "repo-redirection" | "shell-output" | "interpreter-file-mutation" | "sed-in-place-mutation"
  readonly message: string
}

export type EffectClassification = {
  readonly effects: readonly WorkflowEffect[]
  readonly ambiguous: boolean
}

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
    if (char === "&" && (command[index + 1] === ">" || command[index - 1] === ">")) continue
    if (!";&|()\n".includes(char)) continue
    result.push(command.slice(start, index))
    if ((char === "&" || char === "|") && command[index + 1] === char) index++
    start = index + 1
  }
  result.push(command.slice(start))
  return result.map((item) => item.trim()).filter(Boolean)
}

function commandPrefix(segment: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `^(?:(?:command|env|sudo)\\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\\S+\\s+)*(?:[\\w./-]+/)?${escaped}\\b`,
    "i",
  ).test(segment.trim().replace(/^\(+/, ""))
}

function stripHeredocs(command: string): string {
  const heredocMatch = /<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/g
  let result = ""
  let lastIndex = 0
  for (const match of command.matchAll(heredocMatch)) {
    const delim = match[1]
    const matchStart = match.index ?? 0
    result += command.slice(lastIndex, matchStart)
    const newlineAfterDelim = command.indexOf("\n", matchStart)
    if (newlineAfterDelim === -1) {
      lastIndex = command.length
      break
    }
    const endDelim = command.indexOf(`\n${delim}`, newlineAfterDelim)
    if (endDelim === -1) {
      lastIndex = command.length
      break
    }
    lastIndex = endDelim + delim.length + 1
  }
  result += command.slice(lastIndex)
  return result
}

function redirectTargets(command: string): string[] {
  const cleanCommand = stripHeredocs(command)
  const targets: string[] = []
  let quote: string | undefined
  for (let index = 0; index < cleanCommand.length; index++) {
    const char = cleanCommand[index]
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    const operator = char === ">" ? 1 : char === "&" && cleanCommand[index + 1] === ">" ? 2 : 0
    if (!operator) continue
    if (operator === 1 && cleanCommand[index + 1] === "&" && /[0-9-]/.test(cleanCommand[index + 2] ?? "")) {
      index += 2
      continue
    }
    if (operator === 2) {
      index++
      if (cleanCommand[index + 1] === ">") index++
    }
    if (operator === 1 && cleanCommand[index + 1] === ">") index++
    index++
    while (/\s/.test(cleanCommand[index] ?? "")) index++
    if (cleanCommand[index] === '"' || cleanCommand[index] === "'") {
      const targetQuote = cleanCommand[index]
      const start = ++index
      while (index < cleanCommand.length && cleanCommand[index] !== targetQuote) index++
      targets.push(cleanCommand.slice(start, index))
      continue
    }
    const start = index
    while (index < cleanCommand.length && !/[\s;&|()]/.test(cleanCommand[index] ?? "")) index++
    targets.push(cleanCommand.slice(start, index))
    index--
  }
  return targets.filter(Boolean)
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, path.resolve(root, target))
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export function check(command: string, cwd: string): Rule | undefined {
  const targets = redirectTargets(command)
  if (targets.some((target) => isInside(cwd, target)))
    return { rule: "repo-redirection", message: "Do not use shell redirection to write inside the repository." }
  if (hasInterpreter(command) && interpreterWriteIntent(command)) {
    return {
      rule: "interpreter-file-mutation",
      message: "Do not use python, node, perl, or ruby scripts in shell commands to write or edit files in the repository. Use the dedicated edit or write tools instead.",
    }
  }
  if (/\bsed\s+-[a-zA-Z]*i/i.test(command)) {
    return {
      rule: "sed-in-place-mutation",
      message: "Do not use sed -i to edit files in place. Use the dedicated edit tool for exact string replacements.",
    }
  }
  if (
    /^\s*(?:echo\b|printf\b|cat\s*<<)/i.test(command) &&
    (/(?:^|[^\w]|\\n)STATE:\s*(?:done|needs_input|blocked)\b/i.test(command) ||
      (/(?:^|[^\w]|\\n)PHASE:\s*\w+/i.test(command) && /(?:^|[^\w]|\\n)VERIFIED:/i.test(command)))
  ) {
    return {
      rule: "shell-output",
      message: "Do not use shell commands (echo/cat/printf) to output your final response or status line. Output text directly in your assistant chat reply.",
    }
  }
  return undefined
}

export function classifyEffects(command: string): EffectClassification {
  if (!command.trim()) return { effects: ["NONE"], ambiguous: false }
  const effects = new Set<WorkflowEffect>(["PROCESS_EXECUTION"])
  let ambiguous = false

  if (hasWriteRedirect(command)) effects.add("FILESYSTEM_WRITE")
  if (hasReadRedirect(command)) effects.add("FILESYSTEM_READ")

  for (const segment of segments(command)) {
    const parsed = commandParts(segment)
    if (!parsed) {
      ambiguous = true
      continue
    }
    const name = parsed.name
    const args = parsed.args.map((item) => item.toLowerCase())
    if (READ_COMMANDS.has(name)) effects.add("FILESYSTEM_READ")
    if (FILE_MUTATION_COMMANDS.has(name)) {
      if (name !== "sed" || args.some((item) => item === "-i" || item.startsWith("-i") || item === "--in-place"))
        effects.add("FILESYSTEM_WRITE")
      else effects.add("FILESYSTEM_READ")
    }
    if (name === "perl" && args.some((item) => item.includes("p") && item.startsWith("-")))
      effects.add("FILESYSTEM_WRITE")
    if (name === "git") classifyGit(args, effects)
    if (PACKAGE_COMMANDS.has(name) && packageMutation(args)) {
      effects.add("PACKAGE_INSTALL")
      effects.add("BUILD_MUTATION")
    }
    if (buildMutation(name, args)) effects.add("BUILD_MUTATION")
    if (DOWNLOAD_COMMANDS.has(name) && downloadWrites(name, args)) effects.add("FILESYSTEM_WRITE")
    if (INTERPRETERS.has(name)) {
      ambiguous = true
      if (interpreterWriteIntent(command)) effects.add("FILESYSTEM_WRITE")
    }
    if (
      !READ_COMMANDS.has(name) &&
      !SAFE_COMMANDS.has(name) &&
      !FILE_MUTATION_COMMANDS.has(name) &&
      !TEST_COMMANDS.has(name) &&
      name !== "git" &&
      (!PACKAGE_COMMANDS.has(name) || !safePackageCommand(name, args))
    )
      ambiguous = true
  }

  return { effects: [...effects], ambiguous }
}


export type WriteTargetAnalysis = {
  readonly targets: readonly string[]
  readonly unresolved: boolean
}

function resolveTarget(cwd: string, value: string): string {
  const expanded = value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value
  return path.resolve(cwd, expanded)
}

function positional(args: readonly string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg) continue
    if (["-o", "--output", "-O", "--output-document", "-P", "--directory-prefix"].includes(arg)) {
      index++
      continue
    }
    if (arg.startsWith("-")) continue
    values.push(arg)
  }
  return values
}

function interpreterWriteLiterals(command: string): string[] {
  if (!hasInterpreter(command)) return []
  const found = new Set<string>()
  const patterns = [
    /\bopen\s*\(\s*["']([^"']+)["']\s*,\s*["'][^"']*[wax+][^"']*["']/gi,
    /\bPath\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*(?:write_(?:text|bytes)|mkdir)\s*\(/gi,
    /\bPath\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*open\s*\(\s*["'][^"']*[wax+][^"']*["']/gi,
    /\b(?:writeFileSync|writeFile|appendFileSync|createWriteStream|mkdirSync|mkdir|rmSync|unlinkSync|rmdirSync|renameSync|copyFileSync)\s*\(\s*["']([^"']+)["']/gi,
    /\b(?:urlretrieve|download)\s*\(\s*[^,]+\s*,\s*["']([^"']+)["']/gi,
    /\b(?:makedirs|mkdir)\s*\(\s*["']([^"']+)["']/gi,
    /\b(?:remove|unlink|rmdir)\s*\(\s*["']([^"']+)["']/gi,
    /\b(?:copy|copy2|move|rename|replace)\s*\(\s*[^,]+\s*,\s*["']([^"']+)["']/gi,
  ]
  for (const pattern of patterns)
    for (const match of command.matchAll(pattern)) if (match[1]) found.add(match[1])

  if (found.size === 0 && interpreterWriteIntent(command)) {
    const fileLike = /["']([^"'<>|:*?\n\r\t]+\.[a-zA-Z0-9]{1,8})["']/g
    for (const match of command.matchAll(fileLike)) {
      if (match[1] && !match[1].startsWith("http://") && !match[1].startsWith("https://") && !match[1].startsWith("package:")) {
        found.add(match[1])
      }
    }
  }

  return [...found]
}

function interpreterWriteIntent(command: string): boolean {
  return (
    /\bopen\s*\([^)]*,\s*["'][^"']*[wax+][^"']*["']/i.test(command) ||
    /\b(?:writeFileSync|writeFile|appendFileSync|createWriteStream|mkdirSync|mkdir|rmSync|unlinkSync|rmdirSync|renameSync|copyFileSync|urlretrieve|download|makedirs|remove|unlink|rmdir|copy2?|move|rename|replace|write_text|write_bytes)\b/i.test(
      command,
    )
  )
}

function urlArguments(args: readonly string[]): string[] {
  const urls: string[] = []
  const valueOptions = new Set(["-o", "--output", "--output-document", "-P", "--directory-prefix"])
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg) continue
    if (valueOptions.has(arg)) {
      index++
      continue
    }
    if (/^https?:\/\//i.test(arg)) urls.push(arg)
  }
  return urls
}

function urlFilename(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    const filename = path.basename(parsed.pathname)
    return filename || undefined
  } catch {
    return undefined
  }
}

function downloadWrites(name: string, args: readonly string[]): boolean {
  if (name === "wget") return urlArguments(args).length > 0
  return args.some(
    (arg) =>
      arg === "-o" ||
      arg === "--output" ||
      arg.startsWith("--output=") ||
      arg === "-O" ||
      arg === "--remote-name",
  )
}

function downloadTargets(name: string, args: readonly string[], cwd: string): { targets: string[]; unresolved: boolean } {
  const targets: string[] = []
  let directory: string | undefined
  let explicit = false
  let remoteName = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg) continue
    if (name === "curl" && ["-o", "--output"].includes(arg)) {
      const target = args[++index]
      if (target) {
        explicit = true
        targets.push(resolveTarget(cwd, target))
      }
      continue
    }
    if (name === "wget" && ["-O", "--output-document"].includes(arg)) {
      const target = args[++index]
      if (target) {
        explicit = true
        targets.push(resolveTarget(cwd, target))
      }
      continue
    }
    if (arg.startsWith("--output=")) {
      explicit = true
      targets.push(resolveTarget(cwd, arg.slice("--output=".length)))
      continue
    }
    if (arg.startsWith("--output-document=")) {
      explicit = true
      targets.push(resolveTarget(cwd, arg.slice("--output-document=".length)))
      continue
    }
    if (name === "wget" && ["-P", "--directory-prefix"].includes(arg)) {
      const value = args[++index]
      if (value) directory = resolveTarget(cwd, value)
      continue
    }
    if (name === "wget" && arg.startsWith("--directory-prefix=")) {
      directory = resolveTarget(cwd, arg.slice("--directory-prefix=".length))
      continue
    }
    if (name === "curl" && (arg === "-O" || arg === "--remote-name")) remoteName = true
  }

  if (explicit) return { targets, unresolved: false }
  const urls = urlArguments(args)
  if (name === "curl" && !remoteName) return { targets: [], unresolved: false }

  let unresolved = urls.length === 0
  for (const value of urls) {
    const filename = urlFilename(value)
    if (!filename) {
      unresolved = true
      continue
    }
    targets.push(path.join(directory ?? cwd, filename))
  }
  return { targets, unresolved }
}

export function writeTargetAnalysis(command: string, cwd: string, repositoryRoot = cwd): WriteTargetAnalysis {
  void repositoryRoot
  const found = new Set<string>()
  let unresolved = false
  let currentCwd = cwd

  for (const target of redirectTargets(command)) {
    if (isNullSink(target)) continue
    const resolved = resolveTarget(cwd, target)
    found.add(resolved)
  }

  const interpreterTargets = interpreterWriteLiterals(command)
  for (const target of interpreterTargets) {
    const resolved = resolveTarget(cwd, target)
    found.add(resolved)
  }
  if (hasInterpreter(command) && interpreterWriteIntent(command) && interpreterTargets.length === 0) unresolved = true

  for (const segment of segments(command)) {
    const parsed = commandParts(segment)
    if (!parsed) continue
    const name = parsed.name
    const args = parsed.args

    if (["cd", "chdir", "pushd"].includes(name)) {
      const targetDir = positional(args)[0]
      if (targetDir) {
        currentCwd = resolveTarget(currentCwd, targetDir)
      }
      continue
    }

    if (DOWNLOAD_COMMANDS.has(name)) {
      const download = downloadTargets(name, args, currentCwd)
      for (const target of download.targets) found.add(target)
      unresolved ||= download.unresolved
      continue
    }

    if (!FILE_MUTATION_COMMANDS.has(name)) continue
    const values = positional(args)
    if (values.length === 0) {
      unresolved = true
      continue
    }
    if (["cp", "copy", "copy-item", "install", "move", "move-item", "mv", "ren", "rename", "rename-item"].includes(name)) {
      const target = resolveTarget(currentCwd, values.at(-1)!)
      found.add(target)
      continue
    }
    if (["chmod", "chown"].includes(name)) {
      for (const value of values.slice(1)) {
        const target = resolveTarget(currentCwd, value)
        found.add(target)
      }
      continue
    }
    if (["del", "erase", "md", "mkdir", "rd", "remove-item", "rm", "rmdir", "tee", "touch", "truncate"].includes(name)) {
      for (const value of values) {
        const target = resolveTarget(currentCwd, value)
        found.add(target)
      }
      continue
    }
    unresolved = true
  }

  return { targets: [...found], unresolved }
}

export function writeTargets(command: string, cwd: string, repositoryRoot = cwd): string[] {
  return [...writeTargetAnalysis(command, cwd, repositoryRoot).targets]
}

export function readTargets(command: string, cwd: string): string[] {
  const targets: string[] = []
  const interpreterReads = [
    /\bopen\s*\(\s*["']([^"']+)["']\s*,\s*["'][^"']*r[^"']*["']/gi,
    /\bPath\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*(?:read_text|read_bytes)\s*\(/gi,
    /\b(?:readFileSync|readFile)\s*\(\s*["']([^"']+)["']/gi,
  ]
  for (const pattern of interpreterReads)
    for (const match of command.matchAll(pattern)) {
      const value = match[1]
      if (value) targets.push(resolveTarget(cwd, value))
    }
  for (const segment of segments(command)) {
    const parsed = commandParts(segment)
    if (!parsed || (!READ_COMMANDS.has(parsed.name) && !INTERPRETERS.has(parsed.name))) continue
    const args = parsed.args
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]
      if (!arg) continue
      if (arg === ">" || arg === ">>" || arg === "&>" || arg === "&>>") {
        index++
        continue
      }
      if (["-c", "-e", "--command", "--eval"].includes(arg.toLowerCase())) {
        index++
        continue
      }
      if (arg.startsWith("-")) continue
      if (!path.isAbsolute(arg) && !arg.startsWith(".") && !arg.startsWith("~") && !arg.includes("/") && !arg.includes("\\")) continue
      const expanded = arg === "~" || arg.startsWith("~/") ? path.join(os.homedir(), arg.slice(1)) : arg
      targets.push(path.resolve(cwd, expanded))
    }
  }
  return [...new Set(targets)]
}

export function fileMutationViaInterpreter(command: string): string | undefined {
  if (!hasInterpreter(command) || !hasHeredoc(command)) return undefined
  const body = command.slice(command.indexOf("\n") + 1)
  if (!/\b(?:open|writeFile|write_text|write_bytes|createWriteStream)\s*\(/i.test(body)) return undefined
  return "interpreter file mutation through a heredoc"
}

function commandParts(segment: string): { readonly name: string; readonly args: readonly string[] } | undefined {
  const values = tokenValues(segment)
  let index = 0
  while (
    index < values.length &&
    ["command", "env", "exec", "nice", "sudo", "time"].includes(values[index]!.toLowerCase())
  )
    index++
  while (index < values.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(values[index]!)) index++
  const raw = values[index]
  if (!raw) return undefined
  return { name: path.basename(raw).toLowerCase(), args: values.slice(index + 1) }
}

function tokenValues(value: string): string[] {
  const result: string[] = []
  let token = ""
  let quote: string | undefined
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote) {
      if (char === "\\" && quote === '"') {
        token += value[++index] ?? ""
        continue
      }
      if (char === quote) {
        quote = undefined
        continue
      }
      token += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "\\") {
      token += value[++index] ?? ""
      continue
    }
    if (/\s/.test(char)) {
      if (token) result.push(token)
      token = ""
      continue
    }
    token += char
  }
  if (token) result.push(token)
  return result
}

function classifyGit(args: readonly string[], effects: Set<WorkflowEffect>): void {
  let operation: string | undefined
  for (let index = 0; index < args.length; index++) {
    const item = args[index]
    if (!item) continue
    if (GIT_OPTIONS_WITH_VALUES.has(item)) {
      index++
      continue
    }
    if (item.startsWith("-")) continue
    operation = item
    break
  }
  if (!operation) return
  if (GIT_READ_COMMANDS.has(operation)) {
    effects.add("FILESYSTEM_READ")
    return
  }
  if (!GIT_MUTATION_COMMANDS.has(operation)) {
    if (operation === "fetch" || operation === "ls-remote") effects.add("NETWORK_READ")
    else ambiguousGit(effects)
    return
  }
  effects.add("REPOSITORY_MUTATION")
  effects.add("FILESYSTEM_WRITE")
  if (operation === "push") effects.add("NETWORK_WRITE")
}

function ambiguousGit(effects: Set<WorkflowEffect>): void {
  effects.add("REPOSITORY_MUTATION")
}

function packageMutation(args: readonly string[]): boolean {
  return args.some((item) => ["add", "install", "i", "remove", "uninstall", "upgrade", "update"].includes(item))
}

function buildMutation(name: string, args: readonly string[]): boolean {
  if (["bazel", "bazelisk", "cmake", "gradle", "make", "mvn", "ninja", "soong"].includes(name)) return true
  if (["cargo", "go"].includes(name)) return args.some((item) => ["build", "fmt", "install", "test"].includes(item))
  if (["bun", "npm", "pnpm", "yarn"].includes(name)) return args.some((item) => ["build", "test"].includes(item))
  return false
}

function safePackageCommand(name: string, args: readonly string[]): boolean {
  const first = args[0]
  if (!first) return false
  if (SAFE_PACKAGE_COMMANDS.has(first)) return true
  if (["bun", "npm", "pnpm", "yarn"].includes(name) && first === "run")
    return ["check", "format:check", "lint", "typecheck", "test"].includes(args[1] ?? "")
  if (["cargo", "go"].includes(name) && (first === "test" || first === "check"))
    return true
  return first === "--version" || first === "-v"
}

function isNullSink(target: string): boolean {
  const value = target.replace(/^["']|["']$/g, "").toLowerCase()
  return (
    value === "/dev/null" ||
    value === "/dev/stdout" ||
    value === "/dev/stderr" ||
    value === "nul" ||
    value === "nul:"
  )
}

function hasWriteRedirect(command: string): boolean {
  const cleanCommand = stripHeredocs(command)
  const targets = redirectTargets(cleanCommand)
  if (targets.length > 0 && targets.every(isNullSink)) return false
  let quote: string | undefined
  for (let index = 0; index < cleanCommand.length; index++) {
    const char = cleanCommand[index]
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === ">") {
      if (cleanCommand[index + 1] !== "&") return true
      const target = cleanCommand[index + 2]
      if (target !== undefined && !/[0-9-]/.test(target)) return true
    }
    if (char === "&" && cleanCommand[index + 1] === ">") return true
  }
  return false
}

function hasReadRedirect(command: string): boolean {
  let quote: string | undefined
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
    if (char !== "<" || command[index + 1] === "<") continue
    return true
  }
  return false
}

function hasInterpreter(command: string): boolean {
  return segments(command).some((segment) => {
    const parsed = commandParts(segment)
    return parsed ? INTERPRETERS.has(parsed.name) : false
  })
}

function hasHeredoc(command: string): boolean {
  let quote: string | undefined
  for (let index = 0; index < command.length - 1; index++) {
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
    if (char === "<" && command[index + 1] === "<") return true
  }
  return false
}

export * as ShellPolicy from "./shell-policy"
