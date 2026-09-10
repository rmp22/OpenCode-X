import type { NodeKind } from "./types"

export class UnauthorizedNodeToolError extends Error {
  constructor(readonly toolName: string, readonly allowedTools: readonly string[]) {
    super(`Tool '${toolName}' is not authorized for the active graph node. Allowed tools: [${allowedTools.join(", ")}]`)
    this.name = "UnauthorizedNodeToolError"
  }
}

export const TOOL_ALIASES: Record<string, string> = {
  sh: "bash",
  terminal: "bash",
  command: "bash",
  exec: "bash",
  write: "edit",
  patch: "edit",
  cat: "read",
  find: "glob",
  rg: "grep",
}

export function canonicalToolName(toolName: string): string {
  const lower = toolName.toLowerCase()
  return TOOL_ALIASES[lower] ?? lower
}

export class NodeToolRouter {
  private readonly allowedSet: Set<string>
  readonly allowedTools: readonly string[]

  constructor(allowedTools: readonly string[]) {
    this.allowedTools = [...allowedTools]
    this.allowedSet = new Set(allowedTools.map((t) => canonicalToolName(t)))
  }

  isToolAllowed(toolName: string): boolean {
    if (this.allowedTools.includes("*")) return true
    if (this.allowedTools.length === 0) return false
    const canonical = canonicalToolName(toolName)
    return this.allowedSet.has(canonical) || this.allowedSet.has(toolName.toLowerCase())
  }

  filterTools<TTool extends { readonly name: string }>(tools: readonly TTool[]): TTool[] {
    if (this.allowedTools.includes("*")) return [...tools]
    if (this.allowedTools.length === 0) return []
    return tools.filter((t) => this.isToolAllowed(t.name))
  }

  assertToolAllowed(toolName: string) {
    if (!this.isToolAllowed(toolName)) {
      throw new UnauthorizedNodeToolError(toolName, this.allowedTools)
    }
  }
}

export type PromptArchetype =
  | "quick_fix"
  | "mutation"
  | "refactor"
  | "investigation"
  | "audit"
  | "steer"

export type PromptVelocity = "fast" | "standard" | "careful"

export type PromptSteeringAnalysis = {
  readonly archetype: PromptArchetype
  readonly velocity: PromptVelocity
  readonly pipelineId: string
  readonly intentSummary: string
  readonly explicitTargets: readonly string[]
  readonly forbiddenActions: readonly string[]
  readonly requiresVerification: boolean
  readonly isMidFlightSteer: boolean
  readonly steerDirective?: string
}

const FILE_PATH_REGEX = /(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/g
const FORBIDDEN_PATTERNS = [
  { pattern: /(?:don't|do not|avoid)\s+(?:run|execute)\s+build/i, action: "build.execute" },
  { pattern: /(?:don't|do not)\s+(?:modify|touch|edit)\s+test/i, action: "test:mutate" },
  { pattern: /(?:don't|do not)\s+(?:commit|git push)/i, action: "git.operation" },
  { pattern: /(?:dry run|read only|don't mutate|no changes)/i, action: "file.write" },
]

export const UserPromptAnalyzer = {
  analyze(
    prompt: string,
    context?: { readonly activePipelineId?: string; readonly isOngoingSession?: boolean },
  ): PromptSteeringAnalysis {
    const clean = prompt.trim()
    const lower = clean.toLowerCase()

    const extractedPaths: string[] = []
    let match: RegExpExecArray | null = null
    while ((match = FILE_PATH_REGEX.exec(clean)) !== null) {
      extractedPaths.push(match[0])
    }

    const forbiddenActions: string[] = []
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(clean)) {
        forbiddenActions.push(rule.action)
      }
    }

    const isSteerKeyword =
      lower.startsWith("stop") ||
      lower.startsWith("cancel") ||
      lower.startsWith("wait") ||
      lower.includes("instead of") ||
      lower.includes("focus only on") ||
      lower.includes("don't do that") ||
      lower.includes("skip the")

    const isMidFlightSteer = Boolean(context?.isOngoingSession && isSteerKeyword)

    const isAudit =
      lower.includes("audit") ||
      lower.includes("security review") ||
      lower.includes("vulnerability") ||
      lower.includes("anti-slop") ||
      lower.includes("compliance")

    const isInvestigation =
      !isAudit &&
      (lower.startsWith("where ") ||
        lower.startsWith("how does ") ||
        lower.startsWith("why ") ||
        lower.startsWith("what is ") ||
        lower.startsWith("explain ") ||
        lower.startsWith("find ") ||
        lower.startsWith("search for ") ||
        lower.includes("show me where") ||
        lower.includes("walk me through"))

    const isQuickFix =
      !isAudit &&
      !isInvestigation &&
      (lower.includes("quick fix") ||
        lower.includes("typo") ||
        lower.includes("one liner") ||
        lower.includes("rename variable") ||
        (extractedPaths.length === 1 && (lower.includes("just change") || lower.includes("fix typo"))))

    const isRefactor =
      !isAudit &&
      !isInvestigation &&
      !isQuickFix &&
      (lower.includes("refactor") ||
        lower.includes("migrate") ||
        lower.includes("architecture") ||
        lower.includes("redesign") ||
        lower.includes("break down into") ||
        extractedPaths.length > 3)

    let archetype: PromptArchetype = "mutation"
    let velocity: PromptVelocity = "standard"
    let pipelineId = "code-mutation-pipeline"
    let requiresVerification = true

    if (isMidFlightSteer) {
      archetype = "steer"
      velocity = "fast"
      pipelineId = context?.activePipelineId ?? "code-mutation-pipeline"
    } else if (isQuickFix) {
      archetype = "quick_fix"
      velocity = "fast"
      pipelineId = "fast-fix-pipeline"
      requiresVerification = true
    } else if (isInvestigation) {
      archetype = "investigation"
      velocity = "fast"
      pipelineId = "investigation-pipeline"
      requiresVerification = false
    } else if (isAudit) {
      archetype = "audit"
      velocity = "standard"
      pipelineId = "audit-pipeline"
      requiresVerification = false
    } else if (isRefactor) {
      archetype = "refactor"
      velocity = "careful"
      pipelineId = "code-mutation-pipeline"
      requiresVerification = true
    }

    const intentSummary = clean.slice(0, 120)
    const steerDirective = isMidFlightSteer
      ? `[USER STEER]: Immediately align execution with: "${clean}"`
      : undefined

    return {
      archetype,
      velocity,
      pipelineId,
      intentSummary,
      explicitTargets: extractedPaths,
      forbiddenActions,
      requiresVerification,
      isMidFlightSteer,
      steerDirective,
    }
  },
}

export const GraphRouter = {
  routePrompt(
    prompt: string,
    context?: { readonly activePipelineId?: string; readonly isOngoingSession?: boolean },
  ): PromptSteeringAnalysis {
    return UserPromptAnalyzer.analyze(prompt, context)
  },

  resolvePipelineForPrompt(prompt: string): string {
    return UserPromptAnalyzer.analyze(prompt).pipelineId
  },

  selectAdaptiveNextNode(
    node: { readonly id: string; readonly kind?: NodeKind } | string,
    event: "success" | "failure" | "steer" | "stalled",
    analysis?: PromptSteeringAnalysis,
  ): string {
    if (event === "steer" && analysis?.explicitTargets.length) {
      return "surgical_patch"
    }

    const kind = typeof node === "object" ? node.kind : undefined
    const id = (typeof node === "object" ? node.id : node).toLowerCase()

    if (kind) {
      if (event === "failure") {
        if (kind === "verify") return "diagnostic_repair"
        return "replan"
      }
      if (event === "success") {
        if (kind === "inspect") {
          return analysis?.archetype === "investigation" ? "synthesize_report" : "plan_graph"
        }
        if (kind === "plan") {
          return "surgical_patch"
        }
        if (kind === "mutate") {
          return analysis?.requiresVerification ? "verify_execution" : "sign_off"
        }
        if (kind === "verify") {
          return "sign_off"
        }
        if (kind === "repair") {
          return "verify_execution"
        }
        if (kind === "signoff") {
          return "sign_off"
        }
      }
      if (event === "stalled") {
        return "divergence_recovery"
      }
      return "sign_off"
    }

    if (event === "failure") {
      if (id.includes("verify") || id.includes("test")) {
        return "diagnostic_repair"
      }
      return "replan"
    }

    if (event === "success") {
      if (id.includes("discover") || id.includes("investigat")) {
        return analysis?.archetype === "investigation" ? "synthesize_report" : "plan_graph"
      }
      if (id.includes("plan")) {
        return "surgical_patch"
      }
      if (id.includes("patch") || id.includes("mutate")) {
        return analysis?.requiresVerification ? "verify_execution" : "sign_off"
      }
      if (id.includes("verify")) {
        return "sign_off"
      }
    }

    if (event === "stalled") {
      return "divergence_recovery"
    }

    return "sign_off"
  },
}

export * as Router from "./router"
