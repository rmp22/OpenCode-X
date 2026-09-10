export type ReflexionEntry = {
  readonly id: string
  readonly action: string
  readonly errorSnippet: string
  readonly diagnosis: string
  readonly invariant: string
  readonly timestamp: number
}

export type ReflexionBuffer = {
  readonly sessionID: string
  readonly entries: readonly ReflexionEntry[]
}

const buffers = new Map<string, ReflexionBuffer>()

export function getBuffer(sessionID: string): ReflexionBuffer {
  return buffers.get(sessionID) ?? { sessionID, entries: [] }
}

export function recordFailure(input: {
  readonly sessionID: string
  readonly action: string
  readonly errorSnippet: string
  readonly diagnosis?: string
  readonly invariant?: string
}): ReflexionBuffer {
  const current = getBuffer(input.sessionID)
  const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  // Extract diagnosis & invariant automatically if not provided
  const diagnosis = input.diagnosis ?? inferDiagnosis(input.action, input.errorSnippet)
  const invariant = input.invariant ?? inferInvariant(input.action, input.errorSnippet)

  const entry: ReflexionEntry = {
    id,
    action: input.action.slice(0, 100),
    errorSnippet: input.errorSnippet.slice(0, 200),
    diagnosis,
    invariant,
    timestamp: Date.now(),
  }

  // Keep up to 6 most recent unique reflections to avoid prompt saturation
  const updated: ReflexionBuffer = {
    sessionID: input.sessionID,
    entries: [...current.entries.slice(-5), entry],
  }
  buffers.set(input.sessionID, updated)
  return updated
}

export function clearBuffer(sessionID: string): void {
  buffers.delete(sessionID)
}

export function renderReflexions(sessionID: string): string | undefined {
  const buf = buffers.get(sessionID)
  if (!buf || buf.entries.length === 0) return undefined

  return [
    "=== EPISODIC REFLEXION MEMORY (Lessons from Prior Trial & Error) ===",
    ...buf.entries.map((e, i) => [
      `[Reflexion #${i + 1}]: Action '${e.action}' failed.`,
      `  Root Cause: ${e.diagnosis}`,
      `  Preserved Invariant: ${e.invariant}`,
    ].join("\n")),
    "Do not repeat these disproven approaches. Carry the invariants into all subsequent code edits.",
    "=== END EPISODIC REFLEXION MEMORY ===",
  ].join("\n")
}

function inferDiagnosis(action: string, error: string): string {
  if (/403|Forbidden/i.test(error)) return "Server blocks automated requests or requires realistic browser headers/User-Agent."
  if (/404|Not Found/i.test(error)) return "Resource path or remote asset URL does not exist."
  if (/ENOENT|no such file/i.test(error)) return "Target path does not exist on disk; directory must be created first."
  if (/EEXIST|file exists/i.test(error)) return "Target already exists and cannot be recreated with conflicting flags."
  if (/syntax error|parse error|SyntaxError/i.test(error)) return "Syntax error in generated code; check unclosed tags, quotes, or types."
  if (/permission denied|EACCES/i.test(error)) return "Permission denied on file or process operation."
  if (/undefined is not/i.test(error)) return "Null/undefined dereference; check callers and object structure."
  if (/timed out|timeout/i.test(error)) return "Operation exceeded maximum execution time; divide into smaller steps."
  return `Action failed with: ${error.slice(0, 100).trim()}`
}

function inferInvariant(action: string, error: string): string {
  if (/403|Forbidden/i.test(error)) return "Pass browser headers (-H 'User-Agent: Mozilla/5.0...'), use python urllib, or vendor from a CDN."
  if (/404|Not Found/i.test(error)) return "Source an alternative valid asset or check URL spellings before downloading."
  if (/ENOENT|no such file/i.test(error)) return "Run mkdir -p on parent directories or verify paths before writing."
  if (/syntax error|parse error|SyntaxError/i.test(error)) return "Review and validate code syntax before saving."
  if (/undefined is not/i.test(error)) return "Validate existence of target properties before calling methods."
  return "Do not repeat the identical action without changing underlying parameters."
}

export * as Reflexion from "./reflexion"
