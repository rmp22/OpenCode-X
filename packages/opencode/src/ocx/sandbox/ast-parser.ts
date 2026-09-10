import path from "node:path"

export interface ParsedCommand {
  readonly name: string
  readonly args: readonly string[]
  readonly flags: readonly string[]
  readonly redirects: readonly string[]
  readonly heredocs: readonly string[]
  readonly isReadOnly: boolean
  readonly isMutation: boolean
}

export interface PipelineAnalysis {
  readonly segments: readonly ParsedCommand[]
  readonly isPiped: boolean
  readonly writeTargets: readonly string[]
  readonly readTargets: readonly string[]
}

const READ_ONLY_COMMANDS = new Set([
  "cat",
  "ls",
  "dir",
  "grep",
  "rg",
  "find",
  "fd",
  "head",
  "tail",
  "less",
  "more",
  "pwd",
  "which",
  "where",
  "echo",
  "printf",
  "test",
  "wc",
])

const MUTATION_COMMANDS = new Set([
  "rm",
  "rmdir",
  "del",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "chmod",
  "chown",
  "sed",
  "tee",
  "truncate",
])

function stripHeredocContent(command: string): { clean: string; heredocs: string[] } {
  const heredocMatch = /<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/g
  const heredocs: string[] = []
  let result = ""
  let lastIndex = 0

  for (const match of command.matchAll(heredocMatch)) {
    const delim = match[1]
    const matchStart = match.index ?? 0
    result += command.slice(lastIndex, matchStart)
    const newlineAfter = command.indexOf("\n", matchStart)
    if (newlineAfter === -1) {
      lastIndex = command.length
      break
    }
    const endDelim = command.indexOf(`\n${delim}`, newlineAfter)
    if (endDelim === -1) {
      heredocs.push(command.slice(newlineAfter + 1))
      lastIndex = command.length
      break
    }
    heredocs.push(command.slice(newlineAfter + 1, endDelim))
    lastIndex = endDelim + delim.length + 1
  }
  result += command.slice(lastIndex)
  return { clean: result, heredocs }
}

export function parseTokens(segment: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: string | undefined

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]
    if (quote) {
      if (char === "\\" && quote === '"') {
        current += segment[++i] ?? ""
        continue
      }
      if (char === quote) {
        quote = undefined
        continue
      }
      current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "\\") {
      current += segment[++i] ?? ""
      continue
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseCommand(rawSegment: string): ParsedCommand {
  const { clean, heredocs } = stripHeredocContent(rawSegment)
  const tokens = parseTokens(clean)
  const flags: string[] = []
  const args: string[] = []
  const redirects: string[] = []

  let name = ""
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]!
    if (!name && !token.startsWith("-") && !token.includes("=")) {
      name = path.basename(token).toLowerCase()
      i++
      continue
    }
    if (token === ">" || token === ">>" || token === "&>" || token === "&>>") {
      const target = tokens[++i]
      if (target) redirects.push(target)
      i++
      continue
    }
    if (token.startsWith(">")) {
      redirects.push(token.replace(/^>+/, ""))
      i++
      continue
    }
    if (token.startsWith("-")) {
      flags.push(token)
    } else {
      args.push(token)
    }
    i++
  }

  const isReadOnly = READ_ONLY_COMMANDS.has(name) && redirects.length === 0
  const isMutation = MUTATION_COMMANDS.has(name) || redirects.length > 0

  return {
    name,
    args,
    flags,
    redirects,
    heredocs,
    isReadOnly,
    isMutation,
  }
}

export function analyzePipeline(command: string): PipelineAnalysis {
  const segments = command
    .split(/\||&&|;/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseCommand)

  const writeTargets: string[] = []
  const readTargets: string[] = []

  for (const seg of segments) {
    writeTargets.push(...seg.redirects)
    if (MUTATION_COMMANDS.has(seg.name) && seg.args.length > 0) {
      if (["cp", "mv"].includes(seg.name)) {
        const last = seg.args.at(-1)
        if (last) writeTargets.push(last)
      } else if (["mkdir", "touch", "rm", "rmdir"].includes(seg.name)) {
        writeTargets.push(...seg.args)
      }
    }
    if (READ_ONLY_COMMANDS.has(seg.name) && seg.args.length > 0) {
      readTargets.push(...seg.args.filter((a) => !a.startsWith("-")))
    }
  }

  return {
    segments,
    isPiped: command.includes("|"),
    writeTargets: [...new Set(writeTargets)],
    readTargets: [...new Set(readTargets)],
  }
}

export * as ASTParser from "./ast-parser"
