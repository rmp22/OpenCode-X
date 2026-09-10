import type { AssistantMessage, Part, Provider, UserMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "./locale"
import * as Model from "./model"
import { stripAttentionTags } from "../ocx/text"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  providers?: Provider[]
  leadingOcxEntries?: Array<{ kind?: string; value: string; summary?: string; state?: string; detail?: string }>
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
  ocxEntries?: Array<{
    kind?: string
    value: string
    summary?: string
    state?: string
    detail?: string
  }>
}

export function formatOcxEntry(entry: { kind?: string; value: string; summary?: string; state?: string; detail?: string }): string {
  const isAudit = entry.kind === "audit" || /^entering audit phase\b/i.test(entry.value)
  const isPlaybook = /playbook/i.test(entry.value) || /playbook/i.test(entry.summary ?? "") || entry.kind === "playbook"
  const isWorkflow = entry.kind === "workflow"
  const isPhase = entry.kind === "phase"
  const icon = entry.state === "completed" ? "✓" : entry.state === "failed" || entry.state === "blocked" ? "!" : "·"

  let label = entry.summary ? `${entry.value} ${entry.summary}` : entry.value
  if (isWorkflow) {
    label = `Workflow: ${label}`
  } else if (isPhase) {
    label = `Phase: ${label}`
  }
  const prefix = isPlaybook || isWorkflow || isPhase ? "◈ " : ""
  const detail = entry.detail ? `\n  ${entry.detail}` : ""
  if (isAudit) return `_[OCX] Audit_${detail || `\n  ${entry.value}`}\n\n`
  return `_${icon} ${prefix}${label}_${detail}\n\n`
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  const providers = Model.index(options.providers)
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  if (options.leadingOcxEntries && options.leadingOcxEntries.length > 0) {
    transcript += `## Session Initialization\n\n`
    for (const entry of options.leadingOcxEntries) {
      transcript += formatOcxEntry(entry)
    }
    transcript += `---\n\n`
  }

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options, providers, msg.ocxEntries)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(
  msg: UserMessage | AssistantMessage,
  parts: Part[],
  options: TranscriptOptions,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
  ocxEntries?: Array<{
    kind?: string
    value: string
    summary?: string
    state?: string
    detail?: string
  }>,
): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata, providers ?? options.providers)
    if (ocxEntries && ocxEntries.length > 0) {
      for (const entry of ocxEntries) {
        result += formatOcxEntry(entry)
      }
    }
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(
  msg: AssistantMessage,
  includeMetadata: boolean,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  const modelName = Model.name(providers, msg.providerID, msg.modelID)

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${modelName}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${stripAttentionTags(part.text)}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      const topic = (part.metadata as any)?.ocx?.topic
      const header = topic ? `_Thought: ${topic}_` : `_Thinking:_`
      return `${header}\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `**Tool: ${part.tool}**\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`
    }
    result += `\n`
    return result
  }

  return ""
}
