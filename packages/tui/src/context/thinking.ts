import { createMemo, type Setter } from "solid-js"
import { useKV } from "./kv"

export type ThinkingMode = "show" | "hide"

const MODES: readonly ThinkingMode[] = ["show", "hide"] as const
const GENERIC_TOPICS = /^(?:working|thought|thinking|reasoning|title|summary)$/i
const LABEL_PREFIX = /^(?:thought|thinking|reasoning|title|summary)\s*[:：\-–—]\s*/i
const UNAVAILABLE_CONTEXT_TOPIC =
  /(?:\b(?:no|missing|unavailable|availability|unknown|absent|without)\b.{0,32}\b(?:request|prompt|context)\b|\b(?:request|prompt|context)\b.{0,32}\b(?:missing|unavailable|availability|unknown|absent|not\s+(?:provided|given|included|available|supplied))\b|\b(?:cannot|can't|unable)\b.{0,32}\b(?:request|prompt|context)\b)/i
const NARRATIVE_TOPIC = /^(?:i|we|let(?:'s| me)|need to|will|going to|first|then|now|thinking|thought|reasoning)\b/i
const VAGUE_TOPIC_WORDS = new Set([
  "a",
  "an",
  "answer",
  "the",
  "change",
  "check",
  "checking",
  "code",
  "context",
  "continue",
  "continuing",
  "current",
  "draft",
  "file",
  "files",
  "handle",
  "handling",
  "inspect",
  "inspecting",
  "issue",
  "missing",
  "next",
  "output",
  "plan",
  "problem",
  "progress",
  "prompt",
  "read",
  "reading",
  "reasoning",
  "request",
  "response",
  "result",
  "review",
  "reviewing",
  "source",
  "step",
  "summary",
  "task",
  "thing",
  "thinking",
  "title",
  "unavailable",
  "update",
  "updating",
  "work",
  "working",
  "no",
  "thought",
])

function isVagueTopic(value: string): boolean {
  const words = value.toLocaleLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) ?? []
  return words.length === 0 || words.every((word) => VAGUE_TOPIC_WORDS.has(word))
}

function isConcreteTopic(value: string): boolean {
  const words = value.toLocaleLowerCase().match(/\p{L}[\p{L}\p{N}]*/gu) ?? []
  return (
    words.length >= 2 &&
    words.length <= 6 &&
    !isVagueTopic(value) &&
    !LABEL_PREFIX.test(value) &&
    !UNAVAILABLE_CONTEXT_TOPIC.test(value) &&
    !NARRATIVE_TOPIC.test(value)
  )
}

// OpenAI's Responses API surfaces reasoning summaries that start with a bolded
// title block: "**Inspecting PR workflow**\n\n<body>". Treat that first block,
// or a complete title still awaiting its body while streaming, as disclosure
// metadata so the TUI can style its header independently from the markdown body.
export function reasoningSummary(text: string) {
  const content = text.trim()
  const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n(?:\r?\n)?|$)/)
  if (!match) return { title: null, body: content }
  const found = match[1].trim()
  // Weak models sometimes echo the polish prompt's literal "**Title**"
  // placeholder back; treat those words as absent rather than rendering
  // "Thought: Title".
  if (
    /^(?:title|thought|thinking|summary)$/i.test(found) ||
    UNAVAILABLE_CONTEXT_TOPIC.test(found) ||
    !isConcreteTopic(found)
  ) {
    return { title: null, body: content.slice(match[0].length).trimStart() }
  }
  return { title: found, body: content.slice(match[0].length).trimEnd() }
}

// The server flags reasoning whose text could not be polished
// (metadata.ocx.rawThinking). That text stays stored for provider replay but is
// not user-facing; only the polished output may render.
export function isRawThinking(metadata: Record<string, unknown> | undefined) {
  const ocx = metadata?.ocx
  return typeof ocx === "object" && ocx !== null && (ocx as { rawThinking?: unknown }).rawThinking === true
}

// The pipeline stamps an early topic (metadata.ocx.topic) before raw thinking
// streams, and the polish pass refreshes it at finish. Headers use it as the
// title until the polished text provides its own bolded title.
export function thinkingTopic(metadata: Record<string, unknown> | undefined) {
  const ocx = metadata?.ocx
  if (typeof ocx !== "object" || ocx === null) return null
  const topic = (ocx as { topic?: unknown }).topic
  if (typeof topic !== "string") return null
  const clean = topic.replace(/\s+/g, " ").trim()
  if (
    !clean ||
    clean.length > 60 ||
    GENERIC_TOPICS.test(clean) ||
    UNAVAILABLE_CONTEXT_TOPIC.test(clean) ||
    !isConcreteTopic(clean)
  )
    return null
  return clean
}

export function reasoningTitle(text: string, metadata: Record<string, unknown> | undefined) {
  return thinkingTopic(metadata) ?? reasoningSummary(text).title
}

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
}

// Cycle order matches the slash command: show → hide → show.
export function nextThinkingMode(current: ThinkingMode): ThinkingMode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length] ?? "show"
}

export function useThinkingMode() {
  const kv = useKV()
  // Capture pre-state before `kv.signal` seeds a default, so we can detect
  // first-time users with a legacy `thinking_visibility` boolean and migrate.
  // The KVProvider only renders children once kv.ready, so reads here are safe.
  const hadStored = kv.get("thinking_mode") !== undefined
  const legacy = kv.get("thinking_visibility")
  const [stored, setStored] = kv.signal<ThinkingMode>("thinking_mode", "hide")

  // The kv signal exposes its setter typed as `Setter<T>` which carries Solid's
  // overload set; passing an updater fn through a property access loses the
  // bivariance trick the existing `setX((prev) => ...)` callsites rely on.
  // Wrap it in a sane shape so consumers can just call `set(next)` or pass
  // an updater.
  const set = (next: ThinkingMode | ((prev: ThinkingMode) => ThinkingMode)) => {
    if (typeof next === "function") setStored(next as Setter<ThinkingMode>)
    else setStored(() => next)
  }

  // Preserve previous experience for users who had explicitly toggled the
  // legacy `thinking_visibility` boolean. First-time users (no legacy key)
  // get the new "hide" default (collapsed thinking).
  if (!hadStored) {
    if (legacy === true) set("show")
    else if (legacy === false) set("hide")
  }

  if ((stored() as string) === "minimal") set("hide")

  const mode = createMemo<ThinkingMode>(() => {
    const value = stored()
    return isThinkingMode(value) ? value : "hide"
  })

  return {
    mode,
    set,
  }
}
