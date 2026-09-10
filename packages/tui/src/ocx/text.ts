export type DeliveryVerdict = {
  readonly phase: string
  readonly depth: string
  readonly state: "done" | "blocked" | "needs_input" | string
}

const phaseStartPattern = /^\s*(?:\*\*)?\s*<PHASE>/i

const phaseTransitionPattern =
  /^\s*(?:\*\*)?\s*phase:\s*[a-z0-9][a-z0-9 -]*\s*->\s*[a-z0-9][a-z0-9 -]*\s*(?:\*\*)?\s*$/i

const terminalHeaderPattern =
  /^\s*(?:\*\*)?\s*<?PHASE>?:?\s*([a-z0-9_-]+(?:\s*->\s*[a-z0-9_-]+)?)\s+DEPTH:\s*([a-z0-9_-]+)\s+STATE:\s*(done|blocked|needs_input)\b\s*(?:\*\*)?\s*$/i

const simpleStatePattern =
  /^\s*(?:\*\*)?\s*STATE:\s*(done|blocked|needs_input)\b\s*(?:\*\*)?\s*$/i

export function parseDeliveryHeader(text: string): DeliveryVerdict | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = terminalHeaderPattern.exec(trimmed)
    if (match) {
      return {
        phase: match[1],
        depth: match[2],
        state: match[3].toLowerCase(),
      }
    }
    const simpleMatch = simpleStatePattern.exec(trimmed)
    if (simpleMatch) {
      return {
        phase: "deliver",
        depth: "comprehensive",
        state: simpleMatch[1].toLowerCase(),
      }
    }
    break
  }
  return undefined
}

const attentionTagTest = /<\/?(?:focus|local|global)(?:\s+(?:segments|magic_chunks)=["'][^"']*["'])?\s*>/i
const attentionTagReplace = /<\/?(?:focus|local|global)(?:\s+(?:segments|magic_chunks)=["'][^"']*["'])?\s*>/gi

export function stripAttentionTags(text: string): string {
  const lines: string[] = []
  for (const line of text.split("\n")) {
    if (!attentionTagTest.test(line)) {
      lines.push(line)
      continue
    }
    const stripped = line.replace(attentionTagReplace, "")
    if (stripped.trim().length > 0) lines.push(stripped)
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n")
}

export function stripPhaseMarkers(text: string, options?: { previousThoughtTitle?: string }): string {
  const kept = stripAttentionTags(text).split("\n").filter((line) => {
    if (phaseStartPattern.test(line)) return false
    if (phaseTransitionPattern.test(line)) return false
    if (terminalHeaderPattern.test(line)) return false
    if (simpleStatePattern.test(line)) return false
    return true
  }).map((line) => {
    if (line.includes("|")) {
      return line.replace(/<br\s*\/?>/gi, ", ")
    }
    return line.replace(/<br\s*\/?>/gi, "\n")
  })
  let result = kept
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")

  if (options?.previousThoughtTitle) {
    const title = options.previousThoughtTitle.trim()
    if (title) {
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const titlePattern = new RegExp(`^(?:\\*\\*|#+\\s*)${escaped}(?:\\*\\*)?\\s*(?:\\n+|$)`, "i")
      result = result.replace(titlePattern, "")
    }
  }

  result = result
    .replace(/\$\$\\text\{([^}]+)\}([^$]*)\$\$/g, "$1$2")
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .replace(/\\notin\b/g, "not in")
    .replace(/\\times\b/g, "*")
    .replace(/\\to\b/g, "->")
    .replace(/\\ge\b/g, ">=")
    .replace(/\\le\b/g, "<=")
    .replace(/\\dots\b/g, "...")
    .replace(/(?<=\s)<([A-Z](?:,\s*[A-Z])*)>(?=\s|[.,;:!)]|$)/g, "`<$1>`")

  return result
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  return typeof value === "string" && value.trim() ? [value] : []
}

export function strategyLabel(input: Record<string, unknown>): string {
  const names = [...new Set(stringList(Array.isArray(input.names) ? input.names : input.name))].join(", ")
  return names ? `Strategy: ${names}` : "Strategy"
}

export function auditLabel(input: Record<string, unknown>): string {
  const artifact = typeof input.artifact === "string" && input.artifact.trim() ? input.artifact.trim() : undefined
  const axes = stringList(input.axes)
  const detail = [artifact, axes.length > 0 ? `(${axes.join(", ")})` : undefined].filter(Boolean).join(" ")
  return detail ? `Audit: ${detail}` : "Audit"
}

export type OcxToolInfo = {
  readonly title: string
  readonly icon: string
  readonly items: readonly string[]
}

export function cleanInputArgs(input: Record<string, unknown>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `(${primitives.map(([key, value]) => `${key}: ${value}`).join(" · ")})`
}

export function formatOcxTool(tool: string, input: Record<string, unknown>): OcxToolInfo {
  if (tool === "ocx_plan" || tool === "plan") {
    const summary = typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : undefined
    const workflow = typeof input.workflow === "string" ? input.workflow : undefined
    const phase = typeof input.phase === "string" ? input.phase : undefined
    const addStep = typeof input.addStep === "string" ? input.addStep : undefined

    let title = "Plan"
    if (summary) {
      title = `Plan: ${summary}`
    } else if (addStep) {
      title = `Plan: Add step "${addStep}"`
    } else if (workflow && phase) {
      title = `Plan: ${workflow} · ${phase}`
    } else if (workflow) {
      title = `Plan: ${workflow}`
    }

    const items: string[] = []
    if (Array.isArray(input.steps)) {
      for (const step of input.steps) {
        if (typeof step === "object" && step !== null) {
          const s = step as Record<string, unknown>
          const content = typeof s.content === "string" ? s.content : typeof s.title === "string" ? s.title : undefined
          const status = typeof s.status === "string" ? s.status : undefined
          if (content) {
            const marker = status === "completed" ? "✓" : status === "in_progress" ? "⠋" : "·"
            items.push(`↳ ${marker} ${content}`)
          }
        } else if (typeof step === "string") {
          items.push(`↳ · ${step}`)
        }
      }
    }

    return { title, icon: "≡", items }
  }

  if (tool === "ocx_context") {
    const op = typeof input.operation === "string" ? input.operation : "inspect"
    const query = typeof input.query === "string" && input.query.trim() ? input.query.trim() : undefined
    const scope = typeof input.scope === "string" && input.scope.trim() ? input.scope.trim() : undefined

    let title = `Context: ${op}`
    if (op === "explore") {
      title = query ? `Context: Explore "${query}"` : scope ? `Context: Explore ${scope}` : "Context: Explore codebase"
    } else if (op === "search") {
      title = query ? `Context: Search "${query}"` : "Context: Search"
    } else if (op === "components") {
      title = scope ? `Context: Components in ${scope}` : "Context: Architecture components"
    } else if (op === "pipelines") {
      title = "Context: Pipelines"
    } else if (op === "stale") {
      title = "Context: Check freshness"
    } else if (query) {
      title = `Context (${op}): "${query}"`
    }

    return { title, icon: "◈", items: [] }
  }

  if (tool === "ocx_codebase") {
    const op = typeof input.operation === "string" ? input.operation : "inspect"
    const query = typeof input.query === "string" && input.query.trim() ? input.query.trim() : undefined

    let title = `Codebase: ${op.replace(/_/g, " ")}`
    if (op === "get_repository_profile") {
      title = "Codebase: Profile repository intelligence"
    } else if (op === "get_repository_map") {
      title = "Codebase: Map architecture"
    } else if (op === "lookup_file") {
      title = query ? `Codebase: Locate "${query}"` : "Codebase: Locate file"
    } else if (op === "lookup_path") {
      title = query ? `Codebase: Resolve "${query}"` : "Codebase: Resolve path"
    } else if (op === "lookup_module") {
      title = query ? `Codebase: Inspect module "${query}"` : "Codebase: Inspect module"
    } else if (op === "plan_search") {
      title = query ? `Codebase: Plan search for "${query}"` : "Codebase: Plan search"
    }

    return { title, icon: "⌘", items: [] }
  }

  if (tool === "ocx_session") {
    const view = typeof input.view === "string" ? input.view : "inspect"
    const title = view === "messages" ? "Session: Inspect recent messages" : "Session: Inspect summary"
    return { title, icon: "◈", items: [] }
  }

  if (tool === "ocx_progress") {
    const status = typeof input.status === "string" ? input.status : undefined
    const check = typeof input.check === "string" ? input.check : undefined
    const evidence = typeof input.evidence === "string" ? input.evidence : undefined
    let title = "Progress"
    if (check) {
      title = `Progress: [${status ?? "update"}] ${check}`
    } else if (status) {
      title = `Progress: ${status}`
    }
    const items = evidence ? [`↳ Evidence: ${evidence}`] : []
    return { title, icon: "✓", items }
  }

  const cleanName = tool.replace(/^ocx_/, "").replace(/_/g, " ")
  const name = cleanName.charAt(0).toUpperCase() + cleanName.slice(1)
  const args = Object.entries(input)
    .filter(([k, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ")

  return {
    title: args ? `${name}: ${args}` : name,
    icon: "◆",
    items: [],
  }
}

export const LaneLabels: Record<string, string> = {
  fast: "⚡ Fast",
  standard: "◈ Standard",
  careful: "🛡 Careful",
  autonomous: "⬡ Autonomous",
}

export const GraphNodeLabels: Record<string, string> = {
  discover: "Discovery",
  explore: "Explore",
  plan: "Plan",
  patch: "Surgical Patch",
  mutate: "Mutation",
  verify: "Verification",
  repair: "Diagnostic Repair",
  audit: "Security Audit",
  review: "Sign-off",
}

export function formatWorkflowIndicator(options: {
  readonly workflow?: string
  readonly phase?: string
  readonly variant?: string
  readonly operation?: { surface?: string; action?: string }
}): { readonly icon: string; readonly label: string; readonly level: "info" | "success" | "warning" } {
  const isFast = options.variant === "fast" || options.phase === "fast" || options.workflow === "fast-fix"
  const isCareful = options.variant === "careful" || options.phase === "careful"
  const icon = isFast ? "⚡" : isCareful ? "🛡" : "◈"
  const lane = isFast ? "Fast" : isCareful ? "Careful" : "Graph"
  const step = options.phase
    ? (GraphNodeLabels[options.phase.toLowerCase()] ?? options.phase)
    : (options.workflow ?? "Agentic")
  const action = options.operation ? ` · ${options.operation.action ?? options.operation.surface}` : ""
  const label = `${lane} · ${step}${action}`
  const level = isFast ? "success" : isCareful ? "warning" : "info"
  return { icon, label, level }
}
