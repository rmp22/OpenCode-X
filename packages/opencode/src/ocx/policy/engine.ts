import type { OperationCategory, PolicyDecision } from "./types"
import { classifyTool, isKnownTool } from "./classification"

export const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)\.git\//,
  /(?:^|\/)\.env(?:\..+)?$/,
  /(?:^|\/)id_rsa(?:$|\.)/,
  /(?:^|\/)id_ed25519(?:$|\.)/,
  /(?:^|\/)credentials\.json$/,
  /(?:^|\/)\.npmrc$/,
]

export const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+-[rf]{1,2}\b\s+[/~]/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[fxd]{1,3}\b/,
  /\bformat\s+[A-Z]:/i,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bgit\s+push\s+(?:--force|-f)\b/,
]

export function isProtectedPath(filePath: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(filePath))
}

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

export class PolicyEngine {
  static allowedCategoriesForPhase(_phase?: string): readonly OperationCategory[] {
    return ["read", "mutate", "execute", "external", "administrative"]
  }

  static evaluate(toolName: string, options: {
    readonly phase?: string
    readonly allowedCategories?: readonly OperationCategory[]
    readonly allowUnknownTools?: boolean
    readonly path?: string
    readonly command?: string
  } = {}): PolicyDecision {
    const category = classifyTool(toolName)
    const isKnown = isKnownTool(toolName)

    if (options.path && isProtectedPath(options.path)) {
      const decision: PolicyDecision = {
        allowed: false,
        category,
        reason: `Access to protected path "${options.path}" is prohibited by security policy`,
      }
      return decision
    }

    if (options.command && isDestructiveCommand(options.command)) {
      const decision: PolicyDecision = {
        allowed: false,
        category,
        reason: `Destructive command "${options.command}" is prohibited by security policy`,
      }
      return decision
    }

    if (!isKnown && options.allowUnknownTools === false) {
      const decision: PolicyDecision = {
        allowed: false,
        category,
        reason: `Tool "${toolName}" is unrecognized and strict policy defaults to deny`,
      }
      return decision
    }

    if (options.allowedCategories) {
      if (!options.allowedCategories.includes(category)) {
        const decision: PolicyDecision = {
          allowed: false,
          category,
          reason: `Operation category "${category}" (tool "${toolName}") is not allowed by category policy`,
        }
        return decision
      }
    }

    const decision: PolicyDecision = {
      allowed: true,
      category,
    }
    return decision
  }
}

export * as PolicyEngineModule from "./engine"
