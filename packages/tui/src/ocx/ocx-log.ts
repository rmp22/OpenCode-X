// Append-only history model for workflow transitions and completed activities.

export type OcxLogEntry = {
  seq: number
  kind: "workflow" | "phase" | "activity"
  value: string
  time: number
  // Short action description shown after the label so indicator rows are not
  // bare names like "OCX: Reasoning".
  summary?: string
  state?: "active" | "completed" | "failed" | "blocked" | "cancelled" | "superseded" | "skipped"
  activityID?: string
}

export type OcxActivityState = NonNullable<OcxLogEntry["state"]>

const AGENTIC_PHASES = new Set(["orient", "hypothesize", "mutate", "evaluate", "converge", "signoff"])

function phaseSummary(
  previous: { workflow: string; phase: string } | undefined,
  next: { workflow: string; phase: string },
): string {
  if (AGENTIC_PHASES.has(next.phase.toLowerCase())) {
    return `capability: ${next.phase}`
  }
  if (!previous) return `starting ${next.workflow} phase at ${next.phase}`
  if (previous.workflow === next.workflow) return `advancing ${next.workflow} phase to ${next.phase}`
  return `moving to ${next.workflow} phase at ${next.phase}`
}

// Emits one entry per real transition: the first update for a session
// establishes the baseline workflow and phase, later updates only emit when
// the workflow name or the phase actually changed.
export function workflowLogEntries(
  previous: { workflow: string; phase: string } | undefined,
  next: { workflow: string; phase: string },
  seq: () => number,
  time: number,
): OcxLogEntry[] {
  const workflowChanged = !previous || previous.workflow !== next.workflow
  const phaseChanged = !previous || previous.phase !== next.phase
  const entries: OcxLogEntry[] = []
  if (workflowChanged)
    entries.push({
      seq: seq(),
      kind: "workflow",
      value: next.workflow,
      time,
      summary: previous ? `switched from ${previous.workflow}` : "selected for this request",
    })
  if (phaseChanged)
    entries.push({ seq: seq(), kind: "phase", value: next.phase, time, summary: phaseSummary(previous, next) })
  return entries
}

export function appendActivityEntry(entries: readonly OcxLogEntry[], entry: OcxLogEntry): OcxLogEntry[] {
  const duplicate = entries.some(
    (item) =>
      item.kind === "activity" &&
      item.value === entry.value &&
      item.state === entry.state &&
      item.activityID === entry.activityID,
  )
  return duplicate ? [...entries] : [...entries, entry]
}

// Positions entries in the transcript: each entry renders after the newest
// message that predates it, so pipeline rows sit between the user prompt and
// the assistant reply like Thinking rows. Both lists are chronological, so
// one merging cursor groups every entry.
export function groupByMessage(
  messages: readonly { id: string; time: { created: number } }[],
  entries: readonly OcxLogEntry[],
): { groups: Map<string, OcxLogEntry[]>; leading: OcxLogEntry[] } {
  const groups = new Map<string, OcxLogEntry[]>()
  const leading: OcxLogEntry[] = []
  let cursor = 0
  for (const entry of entries) {
    while (cursor < messages.length && messages[cursor].time.created <= entry.time) cursor++
    const target = cursor > 0 ? messages[cursor - 1].id : undefined
    if (!target) {
      leading.push(entry)
      continue
    }
    const group = groups.get(target)
    if (group) group.push(entry)
    else groups.set(target, [entry])
  }
  return { groups, leading }
}
