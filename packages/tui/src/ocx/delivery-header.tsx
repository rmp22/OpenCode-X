import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import type { DeliveryVerdict } from "./text"

export function DeliveryHeader(props: { verdict: DeliveryVerdict }) {
  const { theme } = useTheme()

  const stateColor = createMemo(() => {
    const s = props.verdict.state.toLowerCase()
    if (s === "done") return theme.success
    if (s === "blocked") return theme.error
    if (s === "needs_input") return theme.warning
    return theme.accent
  })

  const stateGlyph = createMemo(() => {
    const s = props.verdict.state.toLowerCase()
    if (s === "done") return "✓"
    if (s === "blocked") return "✗"
    if (s === "needs_input") return "?"
    return "·"
  })

  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      paddingTop={0}
      paddingBottom={0}
      flexShrink={0}
      flexDirection="row"
      gap={1}
      border={["left"]}
      borderColor={stateColor()}
      customBorderChars={SplitBorder.customBorderChars}
      backgroundColor={theme.backgroundPanel}
    >
      <text fg={theme.accent}>
        [OCX] ◈ <span style={{ fg: theme.text, bold: true }}>PHASE</span> <span style={{ fg: theme.textMuted }}>{props.verdict.phase}</span>
      </text>
      <text fg={theme.textMuted}>·</text>
      <text fg={theme.accent}>
        <span style={{ fg: theme.text, bold: true }}>DEPTH</span> <span style={{ fg: theme.textMuted }}>{props.verdict.depth}</span>
      </text>
      <text fg={theme.textMuted}>·</text>
      <text fg={stateColor()}>
        <span style={{ bold: true }}>STATE</span> {props.verdict.state} {stateGlyph()}
      </text>
    </box>
  )
}
