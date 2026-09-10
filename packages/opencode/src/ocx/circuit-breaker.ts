export type CircuitState = {
  baselineFailures?: number
  consecutiveFailures: number
  lastFailedCommand?: string
  lastFailureCount?: number
  tripped: boolean
  reason?: string
}

const sessions = new Map<string, CircuitState>()

export function getState(sessionID: string): CircuitState {
  return sessions.get(sessionID) ?? { consecutiveFailures: 0, tripped: false }
}

export function recordTestRun(sessionID: string, input: { command: string; failures: number; passed: boolean }): CircuitState {
  const current = getState(sessionID)
  const baseline = current.baselineFailures ?? input.failures

  if (input.passed) {
    const updated: CircuitState = {
      baselineFailures: baseline,
      consecutiveFailures: 0,
      lastFailureCount: 0,
      tripped: false,
    }
    sessions.set(sessionID, updated)
    return updated
  }

  const consecutive = current.consecutiveFailures + 1
  const compounded = input.failures > (current.lastFailureCount ?? baseline) + 1
  const looped = consecutive >= 3 && current.lastFailedCommand === input.command

  const tripped = compounded || looped
  let reason: string | undefined
  if (compounded) {
    reason = `Compounding regression: failures increased from ${current.lastFailureCount ?? baseline} to ${input.failures}. Stop and revert the regression hunk before making more edits.`
  } else if (looped) {
    reason = `Repetitive failure loop: command "${input.command}" failed 3 consecutive times without progress. Formulate an alternate hypothesis.`
  }

  const updated: CircuitState = {
    baselineFailures: baseline,
    consecutiveFailures: consecutive,
    lastFailedCommand: input.command,
    lastFailureCount: input.failures,
    tripped,
    ...(reason ? { reason } : {}),
  }
  sessions.set(sessionID, updated)
  return updated
}

export function clearSession(sessionID: string): void {
  sessions.delete(sessionID)
}

export function renderCircuitNotice(sessionID: string): string | undefined {
  const state = sessions.get(sessionID)
  if (!state?.tripped || !state.reason) return undefined
  return [
    "=== OCX REGRESSION CIRCUIT BREAKER ===",
    `TRIPPED: ${state.reason}`,
    "Action required: Inspect git diff, isolate the breaking change, or revert the hunk to the clean checkpoint before continuing.",
    "=== END OCX REGRESSION CIRCUIT BREAKER ===",
  ].join("\n")
}

export * as CircuitBreaker from "./circuit-breaker"
