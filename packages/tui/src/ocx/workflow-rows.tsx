import { For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import type { OcxLogEntry } from "./ocx-log"

export function OcxMilestones(props: { sessionID: string; entries: OcxLogEntry[] }) {
  const filtered = () => {
    const failures = props.entries.filter((entry) => entry.state === "failed" || entry.state === "blocked")
    if (failures.length > 0) return failures.slice(-1)
    const auditsAndPlaybooks = props.entries.filter(
      (entry) =>
        entry.kind === "activity" &&
        entry.state === "completed" &&
        (/playbook/i.test(entry.value) ||
          /playbook/i.test(entry.summary ?? "") ||
          /audit/i.test(entry.value) ||
          /audit/i.test(entry.summary ?? "")),
    )
    if (auditsAndPlaybooks.length > 0) return auditsAndPlaybooks
    const notable = props.entries.filter(
      (entry) =>
        entry.kind === "activity" &&
        entry.state === "completed" &&
        !/^progress/i.test(entry.value || "") &&
        !/^progress/i.test(entry.summary || "") &&
        (entry.summary || entry.value),
    )
    if (notable.length > 0) return notable.slice(-1)
    return props.entries.filter((entry) => entry.kind === "phase" || entry.kind === "workflow").slice(-1)
  }

  const formatLabel = (rawLabel: string) => {
    const startingMatch = rawLabel.match(/^starting\s+([a-z0-9_-]+)\s+phase\s+at\s+([a-z0-9_-]+)$/i)
    if (startingMatch) return `${startingMatch[1]} · ${startingMatch[2]}`
    const advancingMatch = rawLabel.match(/^advancing\s+([a-z0-9_-]+)\s+phase\s+to\s+([a-z0-9_-]+)$/i)
    if (advancingMatch) return `${advancingMatch[1]} · ${advancingMatch[2]}`
    const movingMatch = rawLabel.match(/^moving\s+to\s+([a-z0-9_-]+)\s+phase\s+at\s+([a-z0-9_-]+)$/i)
    if (movingMatch) return `${movingMatch[1]} · ${movingMatch[2]}`
    return rawLabel
  }

  const icon = (state: OcxLogEntry["state"], label: string) => {
    if (/loop|repair|cycle/i.test(label)) return "⟳"
    if (/fast/i.test(label)) return "⚡"
    if (/careful|critical/i.test(label)) return "🛡"
    if (/orient|hypothesize|mutate|evaluate|converge|signoff|capability/i.test(label)) return "◈"
    if (state === "completed") return "✓"
    if (state === "failed" || state === "blocked") return "!"
    return state ? "–" : "◈"
  }

  return (
    <Show when={filtered().length > 0}>
      <box paddingLeft={3} flexDirection="column" marginTop={1} flexShrink={0}>
        <For each={filtered()}>
          {(entry) => {
            const rawLabel = entry.summary ? entry.summary : entry.value
            const label = formatLabel(rawLabel)
            const isPlaybook = /playbook/i.test(label)
            const isLoop = /loop|repair|cycle/i.test(label)
            return (
              <text
                fg={
                  entry.state === "failed" || entry.state === "blocked"
                    ? useTheme().theme.error
                    : isLoop
                      ? useTheme().theme.warning
                      : isPlaybook
                        ? useTheme().theme.info
                        : useTheme().theme.textMuted
                }
                wrapMode="none"
              >
                {icon(entry.state, label)} {label}
              </text>
            )
          }}
        </For>
      </box>
    </Show>
  )
}
