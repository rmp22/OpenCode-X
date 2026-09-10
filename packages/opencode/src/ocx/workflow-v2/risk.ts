export type RiskProfile = "routine" | "standard" | "critical"

export type ActionEffect = "read" | "workspace-write" | "blast-radius" | "protected"

const BLAST_RADIUS_COMMAND_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
  /\brm\s+-(?:r|rf|fr)\b/i,
  /\bdrop\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\btruncate\s+table\b/i,
  /\bnpm\s+publish\b/i,
  /\bbun\s+publish\b/i,
  /\bgh\s+release\b/i,
  /\bgh\s+pr\s+merge\b/i,
  /\bsudo\b/i,
  /\bpkexec\b/i,
]

const READ_ONLY_COMMAND_PATTERNS = [
  /^\s*git\s+(status|diff|log|branch|show)\b/,
  /^\s*(ls|pwd|cat|head|tail|grep|rg|find|which|echo)\b/,
]

const PROTECTED_PATH_PATTERNS = [
  /(?:^|[/\\])\.git(?:[/\\]|$)/,
  /(?:^|[/\\])\.env(?:\..*)?$/,
  /(?:^|[/\\])(?:id_rsa|id_ed25519)(?:\.pub)?$/,
  /(?:^|[/\\])credentials(?:\.json)?$/,
]

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(path))
}

export function classifyBashCommand(command: string): ActionEffect {
  const trimmed = command.trim()
  if (BLAST_RADIUS_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "blast-radius"
  }
  if (READ_ONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "read"
  }
  return "workspace-write"
}

export function classifyEffect(toolName: string, input?: Record<string, unknown>): ActionEffect {
  const norm = toolName.toLowerCase()

  if (norm === "read" || norm === "glob" || norm === "grep" || norm === "websearch" || norm === "webfetch") {
    return "read"
  }

  if (norm.startsWith("ocx_") || norm === "todowrite") {
    return "read"
  }

  if (norm === "edit" || norm === "write") {
    const targetPath = (input?.filePath ?? input?.path ?? "") as string
    if (targetPath && isProtectedPath(targetPath)) {
      return "protected"
    }
    return "workspace-write"
  }

  if (norm === "bash") {
    const command = (input?.command ?? "") as string
    return classifyBashCommand(command)
  }

  return "workspace-write"
}

export function checkInvestigationDeviation(
  laneKind: string,
  effect: ActionEffect,
): { isDeviation: boolean; reason?: string } {
  if (laneKind.toLowerCase() === "investigation" && effect === "workspace-write") {
    return {
      isDeviation: true,
      reason: "workspace-write performed during investigation lane",
    }
  }
  return { isDeviation: false }
}

export * as Risk from "./risk"
