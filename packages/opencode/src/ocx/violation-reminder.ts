import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// The exit gates record every finding they raise (calibration store). Models
// bury standing rules under context pressure, so the strongest remedy is to
// re-inject the rules this install actually breaks, right where recency is
// strongest: the tail of the system content.

type RecordShape = { readonly findings?: readonly { readonly id?: unknown }[] }

const RULE_LINES: Record<string, string> = {
  "C7-edit-before-read": "Read a file before editing it",
  "C14-added-comment": "No comments in code",
  "E13-comments-remain": "No comments in code, including edited files",
  "C4-tests-not-green": "Run the test suite before claiming success",
  "C5-claim-without-run": "Run tests before saying tests pass",
  "C6-open-todos": "Close or update todos before finishing",
  "C9-plan-obligation": "Do the checks your plan promised",
  "C17-polish-skipped": "Simplify changed files yourself before finishing",
  "C20-import-cycle": "Never create circular imports",
  "C22-code-in-chat": "Write files with the write tool; never paste code as chat",
  "C23-length-cap": "After a token-cap cut, continue by writing files with tools",
  "C29-plan-check-unknown": "Name the exact check your plan expects",
  "C30-scope-reduced": "Get user approval before narrowing a broad request",
  "D1-design-decision-absent": "Apply the recorded design decisions in changed UI",
  "E10-media-not-localized": "Download media into the project",
  "E12-plan-not-followed": "Build the planned file tree",
  "F12-duplicate-block": "Extract pasted blocks into one named function",
  "F13-empty-scaffold": "Delete scaffolded bodies that do nothing",
  "R1-arithmetic-slip": "Compute numbers with a tool before printing them",
  "O1-output-header": "Start every reply with the required PHASE, DEPTH, and STATE line",
}

const REMINDER_CAP = 3
const CACHE_TTL_MS = 600_000

let cache: { at: number; lines: string[] } | undefined

function countViolations(records: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of records) {
    let parsed: RecordShape
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    for (const finding of parsed.findings ?? []) {
      if (typeof finding.id !== "string") continue
      counts.set(finding.id, (counts.get(finding.id) ?? 0) + 1)
    }
  }
  return counts
}

export function reminderLines(records: readonly string[]): string[] {
  const counts = countViolations(records)
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => RULE_LINES[id])
    .filter((line): line is string => typeof line === "string")
  return [...new Set(ranked)].slice(0, REMINDER_CAP)
}

export function violationReminders(dataDir: string): string[] {
  const fresh = cache && Date.now() - cache.at < CACHE_TTL_MS
  if (!fresh) {
    const file = join(dataDir, "ocx", "findings.jsonl")
    const records = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []
    cache = { at: Date.now(), lines: reminderLines(records) }
  }
  return cache?.lines ?? []
}

export * as ViolationReminder from "./violation-reminder"
