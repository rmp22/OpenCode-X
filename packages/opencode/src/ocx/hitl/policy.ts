import type { ActionRiskClass, AutonomyLevel } from "./types"

const CRITICAL_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bdrop\s+database\b/i,
  /\bdrop\s+table\b/i,
]

export function classifyActionRisk(tool: string, params: unknown): ActionRiskClass {
  if (tool === "read" || tool === "glob" || tool === "grep") {
    return "low"
  }

  if (tool === "edit" || tool === "write") {
    return "medium"
  }

  if (tool === "bash") {
    const cmd = typeof params === "object" && params && "command" in params ? String((params as any).command) : ""
    for (const pattern of CRITICAL_COMMAND_PATTERNS) {
      if (pattern.test(cmd)) {
        return "critical"
      }
    }
    return "medium"
  }

  return "medium"
}

export function requiresUserApproval(risk: ActionRiskClass, autonomy: AutonomyLevel): boolean {
  if (autonomy === "interactive") {
    return risk !== "low"
  }

  if (autonomy === "supervised") {
    return risk === "high" || risk === "critical"
  }

  return risk === "critical"
}
