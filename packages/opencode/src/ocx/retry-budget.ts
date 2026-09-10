export type DenialKey = {
  readonly capability: string
  readonly phase: string
  readonly code: string
  readonly target?: string
}

export type RecordResult = {
  readonly repeated: boolean
  readonly attempts: number
  readonly escalate: boolean
}

const MAX_DENIES_BEFORE_ESCALATION = 5

function normalizeTarget(target: string | undefined): string {
  return (target ?? "").trim().slice(0, 240)
}

export function fingerprint(key: DenialKey): string {
  return [key.capability, key.phase, key.code, normalizeTarget(key.target)].join("")
}

export function record(store: Map<string, number>, key: DenialKey): RecordResult {
  const fingerprintValue = fingerprint(key)
  const attempts = (store.get(fingerprintValue) ?? 0) + 1
  store.set(fingerprintValue, attempts)
  return { repeated: attempts > 1, attempts, escalate: attempts >= MAX_DENIES_BEFORE_ESCALATION }
}

export function isSanctionedRetry(target: string | undefined, fixTarget: string | undefined): boolean {
  if (!target || !fixTarget) return false
  return normalizeTarget(target) === normalizeTarget(fixTarget)
}

export function reset(store: Map<string, number>): void {
  store.clear()
}

export * as RetryBudget from "./retry-budget"
