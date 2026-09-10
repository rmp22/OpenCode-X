import { Show, createMemo } from "solid-js"
import { useSync, type OcxActivityProjection } from "../context/sync"
import { useTheme } from "../context/theme"
import { Spinner } from "../component/spinner"

export function selectPrimaryActivity(input: {
  activity?: OcxActivityProjection
  busy?: boolean
}): string | undefined {
  const activity = primaryActivity(input.activity)
  if (!activity) return undefined
  if (activity.title !== undefined) {
    const trimmed = activity.title.trim()
    return trimmed || undefined
  }
  return activityTitle(activity.kind)
}

export function primaryActivity(activity: OcxActivityProjection | undefined): OcxActivityProjection | undefined {
  return activity?.state === "active" ? activity : undefined
}

export function activityTitle(kind: string): string {
  switch (kind) {
    case "thinking":
      return "Thinking"
    case "playbook":
      return "Playbook"
    case "exploring":
      return "Exploring"
    case "research":
      return "Researching"
    case "git":
      return "Git"
    case "automation":
      return "Automating"
    case "design":
      return "Designing"
    case "review":
      return "Reviewing"
    case "audit":
      return "Auditing"
    case "editing":
      return "Editing"
    case "delegation":
      return "Delegating"
    case "recovery":
      return "Recovering"
    case "verification":
      return "Verifying"
    case "waiting":
      return "Waiting"
    case "blocked":
      return "Blocked"
    default:
      return "Working"
  }
}

export function truncateWithEllipsis(text: string, maxWidth = 80): string {
  if (text.length <= maxWidth) return text
  if (maxWidth <= 3) return text.slice(0, maxWidth)
  return text.slice(0, maxWidth - 3) + "..."
}

export function sanitizeDetail(detail?: string): string {
  if (!detail) return ""
  const trimmed = detail.trim()
  if (trimmed.startsWith("<think>") || trimmed.includes("=== OCX THINKING ===")) {
    return "Reasoning through implementation approach"
  }
  return trimmed
}

export function formatActivityLine(input: {
  phase?: string
  step?: string
  detail?: string
  target?: string
  isStalled?: boolean
  elapsedMs?: number
}): string {
  const parts: string[] = []
  if (input.isStalled) {
    const secs = input.elapsedMs ? Math.round(input.elapsedMs / 1000) : 30
    parts.push("[STALLED " + secs + "s]")
  }
  if (input.phase) {
    parts.push(`[${input.phase}]`)
  }
  if (input.step) {
    parts.push(input.step + ":")
  }
  const cleanDetail = sanitizeDetail(input.detail)
  if (cleanDetail) {
    parts.push(cleanDetail)
  }
  if (input.target) {
    parts.push(`(${input.target})`)
  }
  const line = parts.join(" ")
  return line
}

export function formatActivityLabel(input: { kind: string; title?: string }): string {
  const label = input.title?.trim() || activityTitle(input.kind)
  if (input.kind === "audit") return "[OCX] Audit"
  if (input.kind === "playbook") return `[OCX] ❖ ${label}`
  if (input.kind === "verification") return `[OCX] ✓ ${label}`
  if (input.kind === "thinking") return `[OCX] ✦ ${label}`
  if (input.kind === "recovery" || input.kind === "blocked") return `[OCX] ! ${label}`
  return `[OCX] · ${label}`
}

export function PrimaryActivityRow(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const activity = createMemo(() => {
    if (sync.data.session_status[props.sessionID]?.type === "idle") return undefined
    return primaryActivity(sync.data.session_activity[props.sessionID])
  })

  const color = createMemo(() => {
    const current = activity()
    if (!current) return theme.warning
    if (current.state === "blocked" || current.kind === "blocked" || current.kind === "recovery") return theme.error
    if (current.kind === "audit") return theme.info
    if (current.kind === "thinking") return theme.accent
    if (current.kind === "verification") return theme.success
    if (current.kind === "playbook") return theme.warning
    if (current.kind === "research" || current.kind === "exploring") return theme.info
    return theme.warning
  })

  return (
    <Show when={activity()}>
      {(current) => {
        const titleText = () => {
          const curr = current()
          return formatActivityLabel(curr)
        }

        return (
          <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
            <box flexDirection="row">
              <Spinner color={color()}>{titleText()}</Spinner>
              <Show when={current().progressCurrent !== undefined && current().progressTotal !== undefined && current().kind !== "playbook"}>
                <text fg={theme.textMuted}> · {current().progressCurrent}/{current().progressTotal}</text>
              </Show>
            </box>
            <Show when={current().detail && current().detail !== current().title}>
              <text paddingLeft={2} fg={theme.textMuted} wrapMode="none">
                {current().detail}
              </text>
            </Show>
          </box>
        )
      }}
    </Show>
  )
}

export * as ActivityRow from "./activity-row"
