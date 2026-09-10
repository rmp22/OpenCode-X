export type IntentRevision = {
  readonly id: string
  readonly prompt: string
  readonly previousId?: string
  readonly materialChange: boolean
  readonly invalidated: readonly string[]
  readonly preserved: readonly string[]
}

let counter = 0

export function createRevision(prompt: string, previousId?: string): IntentRevision {
  const id = `rev-${++counter}-${Date.now()}`
  return { id, prompt, ...(previousId ? { previousId } : {}), materialChange: false, invalidated: [], preserved: [] }
}

export function isMaterialChange(previous: string, current: string): boolean {
  const lower = current.trim().toLowerCase()
  if (/^(no|stop|don't|dont|don't change|revert|undo|cancel)\b/.test(lower)) return true
  if (lower.includes("don't change") || lower.includes("do not change") || lower.includes("no public api")) return true
  if (previous.trim().toLowerCase() !== lower && lower.length <= 8) return true
  if (lower.includes("scope narrows") || lower.includes("scope widens") || lower.includes("withdrawn")) return true
  const prevWords = new Set(previous.toLowerCase().split(/\s+/))
  const curWords = current.toLowerCase().split(/\s+/)
  const newWords = curWords.filter((w) => !prevWords.has(w))
  return newWords.length >= 3
}

export function detectIntentRevision(previousPrompt: string, currentPrompt: string, previousRevisionId: string): IntentRevision | undefined {
  if (previousPrompt.trim() === currentPrompt.trim()) return undefined
  const material = isMaterialChange(previousPrompt, currentPrompt)
  if (!material) return undefined
  const rev = createRevision(currentPrompt, previousRevisionId)
  return { ...rev, materialChange: true }
}

export function selectiveInvalidation(input: {
  currentRevision: string
  previousRevision: string
  objects: readonly { id: string; intentRevision: string; kind: string }[]
}): { preserved: string[]; stale: string[]; superseded: string[] } {
  const preserved: string[] = []
  const stale: string[] = []
  const superseded: string[] = []
  for (const obj of input.objects) {
    if (obj.intentRevision === input.currentRevision) preserved.push(obj.id)
    else if (obj.kind === "verification" || obj.kind === "context") stale.push(obj.id)
    else superseded.push(obj.id)
  }
  return { preserved, stale, superseded }
}

export function shouldInvalidate(kind: string, materialChange: boolean): boolean {
  if (!materialChange) return false
  const invalidateKinds = new Set(["workflow", "plan", "verification", "completion", "structural_proposal"])
  return invalidateKinds.has(kind)
}

export function compatibleWorkPreserved(previous: readonly string[], current: readonly string[]): boolean {
  return previous.some((p) => current.includes(p))
}

export * as IntentRevision from "./intent-revision"