import * as path from "path"
import { Cause, Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Tool } from "@/tool/tool"
import { MutationGuard } from "./mutation-guard"
import { OCXOperation } from "./operation"
import { SanityChecker } from "./sanity"
import { PathConstraint } from "./scope/path-constraint"

function splitFindLines(find: string): string[] {
  const lines = find.replaceAll("\r\n", "\n").split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

function scanWindows(
  contentLines: string[],
  findLineCount: number,
  matches: (window: string[]) => boolean,
): string[] {
  const spans: string[] = []
  if (findLineCount === 0 || findLineCount > contentLines.length) return spans
  for (let i = 0; i <= contentLines.length - findLineCount; i++) {
    const window = contentLines.slice(i, i + findLineCount)
    if (matches(window)) spans.push(window.join("\n"))
  }
  return spans
}

function uniqueSpansInFile(content: string, spans: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const span of spans) {
    if (seen.has(span)) continue
    seen.add(span)
    const first = content.indexOf(span)
    if (first !== -1 && first === content.lastIndexOf(span)) unique.push(span)
  }
  return unique
}

function blankSpans(contentLines: string[], searchLines: string[]): string[] {
  const spans: string[] = []
  if (searchLines.length < 3) return spans
  const searchCore = searchLines.filter((line) => line.trim().length > 0)
  if (searchCore.length < 2) return spans
  const maxSpan = searchLines.length * 2
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== searchCore[0].trim()) continue
    let searchIdx = 1
    let end = -1
    for (let k = i + 1; k < contentLines.length && k - i + 1 <= maxSpan; k++) {
      const trimmed = contentLines[k].trim()
      if (trimmed.length === 0) continue
      if (searchIdx >= searchCore.length || trimmed !== searchCore[searchIdx].trim()) {
        end = -1
        break
      }
      searchIdx++
      if (searchIdx === searchCore.length) {
        end = k
        break
      }
    }
    if (end < 0) continue
    if (Math.abs(end - i + 1 - searchLines.length) > Math.max(2, Math.floor(searchLines.length * 0.5))) continue
    spans.push(contentLines.slice(i, end + 1).join("\n"))
  }
  return spans
}

function foldPunctuation(text: string): string {
  return text
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000]/g, " ")
}

export function resolveSpan(content: string, oldString: string): string | undefined {
  const searchLines = splitFindLines(oldString)
  if (searchLines.length === 0) return undefined
  const contentLines = content.split("\n")
  const foldedSearch = searchLines.map(foldPunctuation)
  const spans = [
    ...scanWindows(contentLines, searchLines.length, (window) =>
      window.every((line, j) => line.trimEnd() === searchLines[j].trimEnd()),
    ),
    ...scanWindows(contentLines, searchLines.length, (window) =>
      window.every((line, j) => line.trim() === searchLines[j].trim()),
    ),
    ...blankSpans(contentLines, searchLines),
    ...scanWindows(contentLines, searchLines.length, (window) =>
      window.every((line, j) => foldPunctuation(line) === foldedSearch[j]),
    ),
  ].filter((span) => span.length > 0)
  const candidates = uniqueSpansInFile(content, spans)
  if (candidates.length !== 1) return undefined
  return candidates[0]
}

function describeLineEnding(text: string): string {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  if (crlf > 0 && lf > 0) return `mixed (CRLF:${crlf} LF:${lf})`
  if (crlf > 0) return "CRLF"
  if (lf > 0) return "LF"
  return "single-line"
}

function describeIndent(text: string): string {
  let tabs = 0
  let spaces = 0
  for (const line of text.split("\n")) {
    const match = line.match(/^(\s+)/)
    if (!match || line.trim().length === 0) continue
    if (match[1].includes("\t")) tabs++
    else spaces++
  }
  if (tabs > 0 && spaces > 0) return `mixed (tab-lines:${tabs} space-lines:${spaces})`
  if (tabs > 0) return "tabs"
  if (spaces > 0) return "spaces"
  return "none"
}

function previewLine(line: string, max = 160): string {
  const normalized = line.replace(/\t/g, "    ").replace(/\r$/, "")
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function extractDistinctiveToken(line: string): string | undefined {
  const method = line.match(/\b([A-Za-z_][A-Za-z0-9_]{3,})\s*\(/)
  if (method) return method[1]
  const words = line.match(/\b[A-Za-z_][A-Za-z0-9_]{4,}\b/g) ?? []
  words.sort((a, b) => b.length - a.length)
  return words[0]
}

function isGenericLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 4) return true
  return /^[{}\[\]();,.\s]*$/.test(trimmed)
}

function rankTokenMatches(
  contentLines: string[],
  token: string,
  firstSearch: string,
  limit = 3,
): { total: number; top: Array<{ line: number; text: string }> } {
  const searchWords = new Set(firstSearch.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [])
  const scored: Array<{ line: number; shared: number; text: string }> = []
  for (let i = 0; i < contentLines.length; i++) {
    const candidate = contentLines[i]
    if (!candidate.includes(token)) continue
    let shared = 0
    for (const word of new Set(candidate.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [])) {
      if (searchWords.has(word)) shared++
    }
    scored.push({ line: i + 1, shared, text: candidate })
  }
  scored.sort((a, b) => b.shared - a.shared || a.line - b.line)
  return { total: scored.length, top: scored.slice(0, limit) }
}

export function buildNotFoundHint(content: string, oldString: string): string {
  const contentLines = content.split("\n")
  const searchLines = splitFindLines(oldString)
  const firstSearch = (searchLines[0] ?? "").trim()
  const lastSearch = (searchLines[searchLines.length - 1] ?? "").trim()
  let firstHits = 0
  let firstAt = -1
  if (firstSearch.length > 0) {
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].trim() === firstSearch) {
        if (firstAt === -1) firstAt = i
        firstHits++
      }
    }
  }
  let lastHits = 0
  if (lastSearch.length > 0 && searchLines.length > 1) {
    for (const line of contentLines) {
      if (line.trim() === lastSearch) lastHits++
    }
  }
  const parts = [
    `file: ${contentLines.length} lines, ${describeLineEnding(content)}, indent ${describeIndent(content)}`,
    `search: ${searchLines.length} lines, ${describeLineEnding(oldString)}, indent ${describeIndent(oldString)}`,
  ]
  const token = firstSearch.length > 0 ? extractDistinctiveToken(firstSearch) : undefined
  if (firstSearch.length > 0) {
    if (firstHits === 0) {
      parts.push(`first-line not found: "${previewLine(firstSearch, 120)}"`)
      if (token) {
        const found = rankTokenMatches(contentLines, token, firstSearch)
        if (found.total === 0) {
          parts.push(`no line contains "${token}" - it may not exist in this file version`)
        } else {
          parts.push(`lines containing "${token}": ${found.total} total (showing best ${found.top.length})`)
          for (const match of found.top) {
            parts.push(`  line ${match.line}: ${previewLine(match.text)}`)
          }
          parts.push(`read the exact lines around the intended match, then retry with verbatim whitespace`)
        }
      }
    } else {
      parts.push(`first-line matches ${firstHits}x${firstAt >= 0 ? ` (first at line ${firstAt + 1})` : ""}`)
    }
  }
  if (searchLines.length > 1 && lastSearch.length > 0) {
    if (lastHits === 0) {
      parts.push("last-line not found")
    } else if (isGenericLine(lastSearch)) {
      parts.push(
        `last-line "${previewLine(lastSearch, 60)}" matches ${lastHits}x (generic anchor - include more surrounding context for uniqueness)`,
      )
    } else {
      parts.push(`last-line matches ${lastHits}x`)
    }
  }
  if (token && firstHits === 0) {
    parts.push(`fix: grep for "${token}", read those lines, copy whitespace verbatim, include more context`)
  } else {
    parts.push("fix: re-read the exact lines, copy whitespace verbatim, and include more surrounding context")
  }
  return parts.join("\n")
}

const readText = (filePath: string): Effect.Effect<string | undefined> =>
  Effect.promise(() => Bun.file(filePath).text()).pipe(
    Effect.map((text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)),
    Effect.catchCause(() => Effect.succeed(undefined)),
  )

type PreEdit = {
  readonly args: Record<string, unknown>
  readonly filePath: string
  readonly oldString: string
  readonly previousContent: string | undefined
  readonly hadPrevious: boolean
}

const NOT_FOUND_PREFIX = "Could not find oldString"

const rehint = <A, E>(cause: Cause.Cause<E>, pre: PreEdit): Effect.Effect<A, E | Error> =>
  Effect.gen(function* () {
    const squashed = Cause.squash(cause)
    const message = squashed instanceof Error ? squashed.message : String(squashed)
    if (!pre.hadPrevious || !message.startsWith(NOT_FOUND_PREFIX)) {
      return yield* Effect.failCause(cause)
    }
    const fresh = yield* readText(pre.filePath)
    if (fresh === undefined) {
      return yield* Effect.failCause(cause)
    }
    return yield* Effect.fail(
      new Error(
        `${NOT_FOUND_PREFIX} in the file. It must match exactly, including whitespace, indentation, and line endings.\n${buildNotFoundHint(fresh, pre.oldString)}`,
      ),
    )
  })

const preEdit = Effect.fn("OCXEdit.preEdit")(function* (args: Record<string, unknown>, ctx: Tool.Context) {
  const passthrough: PreEdit = { args, filePath: "", oldString: "", previousContent: undefined, hadPrevious: false }
  if (typeof args !== "object" || args === null) return passthrough
  const fileParam = args["filePath"]
  const oldParam = args["oldString"]
  if (typeof fileParam !== "string" || fileParam === "" || typeof oldParam !== "string") return passthrough
  const instance = yield* InstanceState.context
  const filePath = path.isAbsolute(fileParam) ? fileParam : path.join(instance.directory, fileParam)
  const violation = MutationGuard.check(
    ctx.messages,
    instance.worktree,
    [filePath],
    ctx.extra?.mutationContext as MutationGuard.Context | undefined,
  )
  if (violation) throw new Error(`${violation.rule}: ${violation.message}`)
  const writeDecision = PathConstraint.authorize(
    PathConstraint.fromMessages(ctx.messages, instance.directory),
    "write",
    filePath,
  )
  if (writeDecision && !writeDecision.allowed) {
    return yield* Effect.die(new Error(PathConstraint.renderBlocked(writeDecision)))
  }
  if (oldParam === "") return { args, filePath, oldString: oldParam, previousContent: undefined, hadPrevious: false }
  const content = yield* readText(filePath)
  if (content === undefined)
    return { args, filePath, oldString: oldParam, previousContent: undefined, hadPrevious: false }
  const known: PreEdit = { args, filePath, oldString: oldParam, previousContent: content, hadPrevious: true }
  if (args["replaceAll"] === true) return known
  if (content.replaceAll("\r\n", "\n").includes(oldParam.replaceAll("\r\n", "\n"))) {
    return known
  }
  const span = resolveSpan(content, oldParam)
  if (span === undefined) {
    throw new Error(
      `Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.\n${buildNotFoundHint(content, oldParam)}`,
    )
  }
  return { args: { ...args, oldString: span }, filePath, oldString: oldParam, previousContent: content, hadPrevious: true }
})

const postEdit = Effect.fn("OCXEdit.postEdit")(function* <A extends { readonly output: string }>(
  result: A,
  pre: PreEdit,
) {
  if (pre.filePath === "") return result
  const current = yield* readText(pre.filePath)
  if (current === undefined) return result
  const notice = SanityChecker.checkSanity(
    pre.filePath,
    current,
    pre.hadPrevious && pre.previousContent !== undefined ? { previousContent: pre.previousContent } : undefined,
  ).notice
  if (!notice) return result
  return { ...result, output: `${result.output}\n\n${notice}` }
})

export const EDIT_GUIDANCE =
  "OCX edit guidance: copy oldString verbatim from a fresh Read, never from memory. Include at least 3 lines with distinctive first and last lines. When an edit reports not found, grep for the symbol name to locate the true definition, re-read those exact lines, and retry."

export const describeEdit = (description: string): string => `${description}\n${EDIT_GUIDANCE}`

export const runEdit = <A extends { readonly output: string }, E, R>(
  args: Record<string, unknown>,
  ctx: Tool.Context,
  execute: (resolved: Record<string, unknown>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> =>
  OCXOperation.observe({ sessionID: ctx.sessionID, operation: "patch" }, Effect.gen(function* () {
    const pre = yield* preEdit(args, ctx)
    const result = yield* execute(pre.args).pipe(Effect.catchCause((cause) => rehint<A, E>(cause, pre)))
    return yield* postEdit(result, pre)
  }))

export * as OCXEdit from "./ocx-edit"
