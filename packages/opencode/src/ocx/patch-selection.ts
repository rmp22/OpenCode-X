import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { Duration, Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import type { LLM } from "@/session/llm"
import type { Finding } from "./exit-gate"
import { VerifyLadder, type CheckResult, type RunCommand } from "./verify-ladder"

export type CandidateFile = {
  readonly path: string
  readonly content: string
}

export type PatchCandidate = {
  readonly label: string
  readonly files: readonly CandidateFile[]
}

export type CandidateSelection = {
  readonly candidate: PatchCandidate
  readonly results: readonly CheckResult[]
  readonly failed: number
  readonly skipped: number
}

export type SelectionInput = {
  readonly cwd: string
  readonly changedPaths: readonly string[]
  readonly currentFiles: readonly CandidateFile[]
  readonly findings: readonly Finding[]
  readonly baselineFailed: number
  readonly user: SessionV1.User
  readonly model: Provider.Model
  readonly sessionID: string
  readonly budgetMs?: number
  readonly exec?: RunCommand
  readonly clock?: () => number
}

const MAX_CANDIDATES = 2
const MAX_FILES = 3
const MAX_FILE_CHARS = 24_000
const MAX_INPUT_CHARS = 36_000
const MAX_FINDING_CHARS = 500
const TIMEOUT_MS = 20_000

const AGENT = {
  name: "ocx-patch-selection",
  mode: "primary" as const,
  hidden: true,
  native: true,
  temperature: 0.1,
  permission: [],
  options: {},
  prompt: "",
}

const RUBRIC = [
  "Generate a minimal repair candidate for the supplied failing check.",
  "Return no unrelated cleanup and do not add dependencies, files, or public API changes.",
  "Only change files listed in <allowed_paths>.",
  "Return JSON only: {\"candidates\":[{\"label\":\"short label\",\"files\":[{\"path\":\"existing path\",\"content\":\"complete file content\"}]}]}.",
  "Return one candidate when a second independent repair is not justified.",
].join("\n")

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function bounded(value: string, limit: number): string {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, limit)
}

function unwrap(raw: string): string {
  const clean = raw.trim()
  const start = clean.indexOf("{")
  const end = clean.lastIndexOf("}")
  return start >= 0 && end > start ? clean.slice(start, end + 1) : ""
}

function candidateFile(value: unknown): CandidateFile | undefined {
  const item = record(value)
  if (!item || typeof item.path !== "string" || typeof item.content !== "string") return undefined
  const path = item.path.trim()
  if (!path || path.length > 260 || path.includes("\u0000")) return undefined
  if (item.content.length > MAX_FILE_CHARS) return undefined
  return { path, content: item.content }
}

export function parseCandidates(raw: string): PatchCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrap(raw))
  } catch {
    return []
  }
  const items = record(parsed)?.candidates
  if (!Array.isArray(items)) return []
  const candidates: PatchCandidate[] = []
  for (const item of items) {
    const value = record(item)
    if (!value || !Array.isArray(value.files)) continue
    const files = value.files.map(candidateFile).filter((file): file is CandidateFile => file !== undefined).slice(0, MAX_FILES)
    if (files.length === 0) continue
    const label = typeof value.label === "string" && value.label.trim() ? bounded(value.label, 80) : `candidate ${candidates.length + 1}`
    candidates.push({ label, files })
    if (candidates.length === MAX_CANDIDATES) break
  }
  return candidates
}

function candidatePrompt(input: SelectionInput): string {
  const allowed = input.changedPaths.map((path) => bounded(path, 260)).join("\n")
  const findings = input.findings
    .slice(0, 6)
    .map((finding) => `- ${finding.id}: ${bounded(finding.message, MAX_FINDING_CHARS)}${finding.span ? ` [${bounded(finding.span, 180)}]` : ""}`)
    .join("\n")
  const files = input.currentFiles
    .slice(0, MAX_FILES)
    .map((file) => `<file path="${bounded(file.path, 260)}">\n${file.content.slice(0, MAX_FILE_CHARS)}\n</file>`)
    .join("\n")
  return [
    `<rubric>\n${RUBRIC}\n</rubric>`,
    `<allowed_paths>\n${allowed}\n</allowed_paths>`,
    `<failed_checks>\n${findings || "none"}\n</failed_checks>`,
    `<files>\n${files}\n</files>`,
    `The current verification has ${input.baselineFailed} failed check(s). Produce an independent minimal candidate.`,
  ].join("\n\n").slice(0, MAX_INPUT_CHARS)
}

function normal(value: string): string {
  return value.replaceAll("\\", "/")
}

function targetPath(root: string, value: string): string | undefined {
  const target = resolve(root, value)
  const rootPath = resolve(root)
  const relativePath = relative(rootPath, target)
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.includes(`${sep}..${sep}`)) return undefined
  return target
}

function existingFile(root: string, value: string): string | undefined {
  const target = targetPath(root, value)
  if (!target) return undefined
  try {
    if (!lstatSync(target).isFile()) return undefined
    const rootReal = realpathSync(root)
    const targetReal = realpathSync(target)
    const relativePath = relative(rootReal, targetReal)
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) return undefined
    return target
  } catch {
    return undefined
  }
}

function validatedCandidate(input: SelectionInput, candidate: PatchCandidate): PatchCandidate | undefined {
  const root = resolve(input.cwd)
  const allowed = new Set(input.changedPaths.map((path) => existingFile(root, path)).filter((path): path is string => path !== undefined))
  const files = candidate.files
    .map((file) => {
      const target = existingFile(root, file.path)
      if (!target || !allowed.has(target)) return undefined
      return { ...file, path: normal(relative(root, target)) }
    })
    .filter((file): file is CandidateFile => file !== undefined)
  if (files.length === 0) return undefined
  return { label: candidate.label, files }
}

function copyWorkspace(source: string, destination: string): void {
  const root = resolve(source)
  cpSync(root, destination, {
    recursive: true,
    filter: (value) => {
      const parts = relative(root, value).split(sep)
      return !parts.includes(".git") && !parts.includes("node_modules")
    },
  })
  const modules = join(root, "node_modules")
  if (!existsSync(modules)) return
  cpSync(modules, join(destination, "node_modules"), {
    recursive: true,
    dereference: true,
    filter: (value) => {
      const parts = relative(modules, value).split(sep)
      return !parts.includes(".bun") && !parts.includes(".cache")
    },
  })
}

function writeFiles(root: string, files: readonly CandidateFile[]): void {
  for (const file of files) {
    const target = existingFile(root, file.path)
    if (!target) throw new Error(`candidate path escapes workspace: ${file.path}`)
    writeFileSync(target, file.content)
  }
}

function defaultExec(input: { command: string; cwd: string; timeoutMs: number; kind: string }): {
  outcome: "passed" | "failed" | "skipped"
  durationMs: number
} {
  try {
    const { execSync } = require("node:child_process")
    const start = Date.now()
    execSync(input.command, { cwd: input.cwd, timeout: input.timeoutMs, stdio: "ignore" })
    return { outcome: "passed", durationMs: Date.now() - start }
  } catch {
    return { outcome: "failed", durationMs: 0 }
  }
}

function verifyCandidate(input: SelectionInput, candidate: PatchCandidate): CheckResult[] {
  const exec = input.exec ?? defaultExec
  const workspace = mkdtempSync(join(tmpdir(), "opencode-ocx-patch-"))
  try {
    copyWorkspace(input.cwd, workspace)
    writeFiles(workspace, candidate.files)
    return [...VerifyLadder.runVerifyLadder({
      changed: candidate.files.map((file) => normal(file.path)),
      cwd: workspace,
      budgetMs: input.budgetMs,
      exec,
      clock: input.clock,
    }).results]
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

function score(result: CandidateSelection): [number, number, number] {
  const duration = result.results.reduce((total, item) => total + (item.durationMs ?? 0), 0)
  return [result.failed, result.skipped, duration]
}

function compare(a: CandidateSelection, b: CandidateSelection): number {
  const left = score(a)
  const right = score(b)
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || a.candidate.label.localeCompare(b.candidate.label)
}

function response(deps: { readonly llm: LLM.Interface }, input: SelectionInput) {
  return deps.llm
    .stream({
      user: input.user,
      sessionID: input.sessionID,
      model: input.model,
      agent: AGENT,
      system: [],
      messages: [{ role: "user" as const, content: candidatePrompt(input) }],
      tools: {},
      retries: 1,
    })
    .pipe(
      Stream.filter(LLMEvent.is.textDelta),
      Stream.map((event) => event.text),
      Stream.mkString,
      Effect.timeout(Duration.millis(TIMEOUT_MS)),
      Effect.catch(() => Effect.succeed("")),
    )
}

export const selectCandidate = Effect.fn("OCXPatchSelection.selectCandidate")(function* (
  deps: { readonly llm: LLM.Interface },
  input: SelectionInput,
) {
  if (input.changedPaths.length === 0 || input.currentFiles.length === 0 || input.baselineFailed <= 0) return undefined
  const responses = yield* Effect.all([response(deps, input), response(deps, input)])
  const candidates = responses
    .flatMap(parseCandidates)
    .map((candidate) => validatedCandidate(input, candidate))
    .filter((candidate): candidate is PatchCandidate => candidate !== undefined)
    .filter((candidate, index, all) =>
      all.findIndex(
        (item) =>
          item.files.length === candidate.files.length &&
          item.files.every((file, fileIndex) => file.path === candidate.files[fileIndex]?.path && file.content === candidate.files[fileIndex]?.content),
      ) === index,
    )
    .slice(0, MAX_CANDIDATES)
  const evaluated: CandidateSelection[] = []
  for (const candidate of candidates) {
    const results = yield* Effect.try({ try: () => verifyCandidate(input, candidate), catch: () => [] as CheckResult[] })
    if (results.length === 0 || results.every((item) => item.outcome === "skipped")) continue
    evaluated.push({
      candidate,
      results,
      failed: results.filter((item) => item.outcome === "failed").length,
      skipped: results.filter((item) => item.outcome === "skipped").length,
    })
  }
  const best = evaluated.toSorted(compare)[0]
  if (!best || (best.failed >= input.baselineFailed && best.failed !== 0)) return undefined
  return best
})

export function applyCandidate(cwd: string, candidate: PatchCandidate, allowedPaths: readonly string[]): void {
  const root = resolve(cwd)
  const allowed = new Set(allowedPaths.map((path) => existingFile(root, path)).filter((path): path is string => path !== undefined))
  for (const file of candidate.files) {
    const target = existingFile(root, file.path)
    if (!target || !allowed.has(target))
      throw new Error(`candidate path is not an existing changed file: ${file.path}`)
  }
  writeFiles(root, candidate.files)
}

export function readCandidateFiles(cwd: string, paths: readonly string[]): CandidateFile[] {
  return paths.slice(0, MAX_FILES).flatMap((path) => {
    const target = existingFile(cwd, path)
    if (!target) return []
    try {
      return [{ path: normal(relative(resolve(cwd), target)), content: readFileSync(target, "utf8") }]
    } catch {
      return []
    }
  })
}

export * as PatchSelection from "./patch-selection"
