const ACTIONS = [
  "inspect the exact error, input, and runtime output",
  "search local callers, siblings, tests, and existing utilities",
  "compare repository history or the nearest known-good implementation",
  "run a minimal executable probe that distinguishes the competing causes",
  "switch to a materially different approach (e.g. alternate tool, python, CDN, or local fallback) and record why the prior path failed",
  "preserve the evidence and ask only for a user-specific blocker",
] as const

export type Result = {
  readonly level: number
  readonly action: string
}

export function next(attempts: number): Result {
  const level = Math.min(ACTIONS.length, Math.max(1, Math.floor(attempts) + 1))
  return { level, action: ACTIONS[level - 1] }
}

export * as Resourcefulness from "./resourcefulness"
