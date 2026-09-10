import apiAdherence from "./practices/api-adherence.txt"
import complexityRedflags from "./practices/complexity-redflags.txt"
import debugDiscipline from "./practices/debug-discipline.txt"
import reviewChecklist from "./practices/review-checklist.txt"
import safetyRules from "./practices/safety-rules.txt"
import testingDoctrine from "./practices/testing-doctrine.txt"
import googleStyle from "./practices/google-style.txt"
import googleEngPractices from "./practices/google-eng-practices.txt"
import googleTesting from "./practices/google-testing.txt"
import googleApiDesign from "./practices/google-api-design.txt"
import googleSecurity from "./practices/google-security.txt"
import type { CheckKind, LedgerEntry } from "./ledger"

export type PracticeSource = {
  readonly url: string
  readonly date: string
}

export type PracticePack = {
  readonly name: string
  readonly description: string
  readonly signals: readonly string[]
  readonly globs: readonly string[]
  readonly sources: readonly PracticeSource[]
  readonly content: string
  readonly path: string
}

export type PracticeSignals = {
  readonly prompt: string
  readonly workflow?: string
  readonly stack?: string
  readonly changedPaths: readonly string[]
  readonly failedChecks: readonly CheckKind[]
}

export type PackAudit = {
  readonly packs: readonly PracticePack[]
  readonly invalid: readonly { path: string; reason: string }[]
}

export type PackSelection = {
  readonly packs: readonly PracticePack[]
  readonly invalid: readonly { path: string; reason: string }[]
}

const MAX_PACK_CHARS = 2_048
const MAX_RULES = 13
const MAX_EXAMPLES = 3
const MAX_PACKS = 2
const MAX_INJECTION_CHARS = 1_500
const SOURCE_DATE = /^\d{4}-\d{2}-\d{2}$/
const SOURCE_URL = /^https:\/\/[^\s]+$/
const NAME = /^[a-z0-9][a-z0-9-]{1,47}$/

const BUILTIN_PACKS: readonly { readonly path: string; readonly raw: string }[] = [
  { path: "practices/api-adherence.txt", raw: apiAdherence },
  { path: "practices/complexity-redflags.txt", raw: complexityRedflags },
  { path: "practices/debug-discipline.txt", raw: debugDiscipline },
  { path: "practices/review-checklist.txt", raw: reviewChecklist },
  { path: "practices/safety-rules.txt", raw: safetyRules },
  { path: "practices/testing-doctrine.txt", raw: testingDoctrine },
  { path: "practices/google-style.txt", raw: googleStyle },
  { path: "practices/google-eng-practices.txt", raw: googleEngPractices },
  { path: "practices/google-testing.txt", raw: googleTesting },
  { path: "practices/google-api-design.txt", raw: googleApiDesign },
  { path: "practices/google-security.txt", raw: googleSecurity },
]

type FrontMatter = {
  name?: string
  description?: string
  signals: string[]
  globs: string[]
  sources: PracticeSource[]
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function listValues(value: string): string[] {
  return value.split(",").map(clean).filter(Boolean)
}

function source(value: string): PracticeSource | undefined {
  const parts = value.split("|").map(clean)
  const url = parts[0]
  const date = parts[1]
  if (!url || !date || !SOURCE_URL.test(url) || !SOURCE_DATE.test(date)) return undefined
  return { url, date }
}

function parseFrontMatter(value: string): FrontMatter | undefined {
  const lines = value.split(/\r?\n/)
  const result: FrontMatter = { signals: [], globs: [], sources: [] }
  let section: "signals" | "globs" | "sources" | undefined
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const field = /^([a-z]+):\s*(.*)$/i.exec(line)
    if (field) {
      const key = field[1]?.toLowerCase()
      const text = clean(field[2] ?? "")
      if (key === "name") result.name = text
      else if (key === "description") result.description = text
      else if (key === "signals" || key === "globs" || key === "sources") {
        section = key
        if (text) {
          if (key === "signals") result.signals.push(...listValues(text))
          if (key === "globs") result.globs.push(...listValues(text))
          if (key === "sources") {
            const parsed = source(text)
            if (parsed) result.sources.push(parsed)
          }
        }
      }
      continue
    }
    const item = /^-\s+(.+)$/.exec(line)?.[1]
    if (!item || !section) continue
    if (section === "signals") result.signals.push(clean(item))
    if (section === "globs") result.globs.push(clean(item))
    if (section === "sources") {
      const parsed = source(item)
      if (parsed) result.sources.push(parsed)
    }
  }
  return result
}

function invalid(reason: string): PackAudit {
  return { packs: [], invalid: [{ path: "", reason }] }
}

export function parsePack(filePath: string, raw: string): PracticePack | PackAudit {
  if (raw.length > MAX_PACK_CHARS) return invalid(`pack exceeds ${MAX_PACK_CHARS} characters`)
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
  if (!match) return invalid("pack needs front matter")
  const metadata = parseFrontMatter(match[1] ?? "")
  const content = (match[2] ?? "").trim()
  if (!metadata?.name || !NAME.test(metadata.name)) return invalid("pack name is missing or invalid")
  if (!metadata.description) return invalid("pack description is missing")
  if (metadata.signals.length === 0 && metadata.globs.length === 0) return invalid("pack needs signals or globs")
  if (metadata.sources.length === 0) return invalid("pack needs at least one dated HTTPS source")
  if (!/^#{1,3}\s+Sources\b/im.test(content)) return invalid("pack needs a Sources section")
  const rules = content.split(/\r?\n/).filter((line) => /^\s*-\s+/.test(line)).length
  if (rules > MAX_RULES) return invalid(`pack has more than ${MAX_RULES} rules`)
  const examples = content.match(/^#{1,3}\s+Example\b/gim)?.length ?? 0
  if (examples > MAX_EXAMPLES) return invalid(`pack has more than ${MAX_EXAMPLES} examples`)
  return {
    name: metadata.name,
    description: metadata.description,
    signals: [...new Set(metadata.signals.map((item) => item.toLowerCase()))],
    globs: [...new Set(metadata.globs)],
    sources: metadata.sources,
    content,
    path: filePath,
  }
}

export function audit(): PackAudit {
  const packs: PracticePack[] = []
  const invalidPacks: { path: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const file of BUILTIN_PACKS) {
    const parsed = parsePack(file.path, file.raw)
    if ("packs" in parsed) {
      invalidPacks.push({ path: file.path, reason: parsed.invalid[0]?.reason ?? "invalid pack" })
      continue
    }
    if (seen.has(parsed.name)) continue
    seen.add(parsed.name)
    packs.push(parsed)
  }
  return { packs, invalid: invalidPacks }
}

export function load(name: string): PracticePack | undefined {
  return audit().packs.find((pack) => pack.name === name)
}

export function list(): readonly Pick<PracticePack, "name" | "description">[] {
  return audit().packs.map((pack) => ({ name: pack.name, description: pack.description }))
}

export const listPacks = list

function globRegex(pattern: string): RegExp {
  let expression = "^"
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?"
        index += 2
      } else {
        expression += ".*"
        index++
      }
    } else if (char === "*") expression += "[^/]*"
    else if (char === "?") expression += "[^/]"
    else expression += char?.replace(/[.+^${}()|[\]\\]/g, "\\$&") ?? ""
  }
  return new RegExp(`${expression}$`, "i")
}

function matchesGlob(pattern: string, value: string): boolean {
  const normalized = value.replaceAll("\\", "/")
  const relativePath = normalized.startsWith("/") ? normalized : normalized.replace(/^\.\//, "")
  return globRegex(pattern.replaceAll("\\", "/")).test(relativePath)
}

function signalText(input: PracticeSignals): string {
  return [input.prompt, input.workflow, input.stack, ...input.failedChecks].filter(Boolean).join(" ").toLowerCase()
}

function score(pack: PracticePack, input: PracticeSignals): number {
  const text = signalText(input)
  const signalScore = pack.signals.reduce(
    (total, signal) => (text.includes(signal.toLowerCase()) ? total + 3 : total),
    0,
  )
  const pathScore = input.changedPaths.some((path) => pack.globs.some((glob) => matchesGlob(glob, path))) ? 2 : 0
  return signalScore + pathScore
}

export function select(input: PracticeSignals): PackSelection {
  const auditResult = audit()
  const packs = auditResult.packs
    .map((pack) => ({ pack, score: score(pack, input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.pack.name.localeCompare(b.pack.name))
    .slice(0, MAX_PACKS)
    .map((item) => item.pack)
  return { packs, invalid: auditResult.invalid }
}

export function render(pack: PracticePack): string {
  return [
    `=== OCX PRACTICE PACK: ${pack.name} ===`,
    pack.description,
    pack.content,
    `Sources: ${pack.sources.map((item) => `${item.url} (${item.date})`).join(", ")}`,
    "=== END OCX PRACTICE PACK ===",
  ].join("\n")
}

export function renderSelected(packs: readonly PracticePack[], maxChars = MAX_INJECTION_CHARS): string {
  const output: string[] = []
  let size = 0
  for (const pack of packs) {
    const text = render(pack)
    const remaining = maxChars - size - (output.length > 0 ? 2 : 0)
    if (remaining <= 80) break
    const bounded = text.length > remaining ? `${text.slice(0, remaining - 3).trimEnd()}...` : text
    output.push(bounded)
    size += bounded.length + (output.length > 1 ? 2 : 0)
    if (bounded !== text) break
  }
  return output.join("\n\n").slice(0, maxChars)
}

const FINDING_PACK_SIGNALS: Record<string, readonly string[]> = {
  "C3-typecheck-failed": ["testing-doctrine", "api-adherence"],
  "C4-tests-not-green": ["testing-doctrine"],
  "C7-edit-before-read": ["review-checklist", "safety-rules"],
  "C20-import-cycle": ["complexity-redflags", "api-adherence"],
  "C26-unlisted-dependency": ["api-adherence", "safety-rules"],
  "C32-rerun-greenwashing": ["testing-doctrine", "debug-discipline"],
  "R1-review-finding": ["review-checklist"],
  "mutation-debugging": ["debug-discipline"],
}

export function proposals(packs: readonly PracticePack[], findings: readonly { readonly id: string }[]): string[] {
  const ids = [...new Set(findings.map((finding) => finding.id))]
  return packs.flatMap((pack) => {
    const matched = ids.filter((id) => FINDING_PACK_SIGNALS[id]?.includes(pack.name))
    return matched.length > 0
      ? [`${pack.name}: recurring ${matched.join(", ")}; add a source-backed rule for the observed failure.`]
      : []
  })
}

export function signalsFromEntries(entries: readonly LedgerEntry[]): {
  readonly changedPaths: readonly string[]
  readonly failedChecks: readonly CheckKind[]
} {
  const changedPaths = [
    ...new Set(entries.flatMap((entry) => (entry.kind === "write" || entry.kind === "edit" ? [entry.path] : []))),
  ]
  const failedChecks = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.kind === "command" && entry.outcome === "failed" && entry.check ? [entry.check] : [],
      ),
    ),
  ]
  return { changedPaths, failedChecks }
}

export * as PracticePacks from "./practice-packs"
