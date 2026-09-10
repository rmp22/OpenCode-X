import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type ADRFilePlan = {
  readonly path: string
  readonly owns: string
  readonly doesNotOwn: string
  readonly importsOrUses: readonly string[]
  readonly publicInputsOrOutputs: readonly string[]
}

export type ADRInput = {
  readonly operation: string
  readonly goal: string
  readonly scope: string
  readonly allowedChanges: readonly string[]
  readonly allowedBreaks: readonly string[]
  readonly nonGoals: readonly string[]
  readonly acceptanceChecks: readonly string[]
  readonly rollbackPlan: string
  readonly files: readonly ADRFilePlan[]
  readonly dependencyDirection: string
  readonly stateOwner: string
  readonly preservedContracts: readonly string[]
}

const ADR_NAME = /^(\d+)-[^/]+\.md$/
const MAX_LINE = 320
const MAX_ITEMS = 8

function clean(value: string, limit = MAX_LINE): string {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, limit)
}

function segment(value: string, fallback: string): string {
  const result = clean(value, 80)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return result || fallback
}

function names(directory: string): { name: string; number: number }[] {
  return readdirSync(directory)
    .flatMap((name) => {
      const match = ADR_NAME.exec(name)
      if (!match) return []
      return [{ name, number: Number(match[1]) }]
    })
    .sort((left, right) => left.number - right.number)
}

function bullets(items: readonly string[]): string[] {
  return items.slice(0, MAX_ITEMS).map((item) => `- ${clean(item)}`)
}

function render(input: ADRInput, previous: string | undefined): string {
  const title = clean(`${input.operation}: ${input.goal}`, 180)
  const files = input.files.slice(0, MAX_ITEMS).map((file) => `- ${clean(file.path, 160)}: ${clean(file.owns, 180)}`)
  return [
    `# ${title}`,
    "",
    `Date: ${new Date().toISOString()}`,
    "Status: Accepted",
    `Supersedes: ${previous ?? "none"}`,
    "",
    "## Context",
    clean(input.scope),
    "",
    "## Decision",
    ...bullets(input.allowedChanges),
    ...(files.length > 0 ? ["", "Files:", ...files] : []),
    "",
    "## Consequences",
    `Dependency direction: ${clean(input.dependencyDirection)}`,
    `State owner: ${clean(input.stateOwner)}`,
    `Acceptance: ${clean(input.acceptanceChecks.join("; "))}`,
    `Preserved: ${clean(input.preservedContracts.join("; ")) || "none recorded"}`,
    `Allowed breaks: ${clean(input.allowedBreaks.join("; ")) || "none recorded"}`,
    `Non-goals: ${clean(input.nonGoals.join("; ")) || "none recorded"}`,
    `Rollback: ${clean(input.rollbackPlan)}`,
    "",
  ].join("\n")
}

export function append(dataDir: string, sessionID: string, input: ADRInput): string {
  const directory = join(dataDir, "ocx", "adr", segment(sessionID, "session"))
  mkdirSync(directory, { recursive: true })
  const existing = names(directory)
  const previous = existing.at(-1)?.name
  const slug = segment(`${input.operation}-${input.goal}`, "decision")
  const content = render(input, previous)
  const first = (existing.at(-1)?.number ?? 0) + 1

  for (let number = first; ; number++) {
    const name = `${String(number).padStart(4, "0")}-${slug}.md`
    const filePath = join(directory, name)
    try {
      writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" })
      return filePath
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue
      throw error
    }
  }
}

export * as ADRStore from "./adr-store"
