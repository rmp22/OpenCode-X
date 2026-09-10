import type { ScopeTelemetry, ScopeLevel, ScopeFinding, ReevaluationEvent } from "./types"

export type TelemetryInput = {
  readonly sessionId: string
  readonly initialScope: ScopeLevel
  readonly finalScope: ScopeLevel
  readonly scopeChanges: readonly ReevaluationEvent[]
  readonly filesInspected: readonly string[]
  readonly filesChanged: readonly string[]
  readonly findingsAtCompletion: readonly ScopeFinding[]
  readonly reviewerVerdict: "under_scoped" | "over_scoped" | "appropriate" | "unknown"
}

export function createTelemetry(input: TelemetryInput): ScopeTelemetry {
  return {
    sessionId: input.sessionId,
    initialScope: input.initialScope,
    finalScope: input.finalScope,
    scopeChanges: input.scopeChanges,
    filesInspected: input.filesInspected,
    filesChanged: input.filesChanged,
    findingsAtCompletion: input.findingsAtCompletion,
    reviewerVerdict: input.reviewerVerdict,
  }
}

export function scopeChanged(telemetry: ScopeTelemetry): boolean {
  return telemetry.initialScope !== telemetry.finalScope
}

export function escalationCount(telemetry: ScopeTelemetry): number {
  return telemetry.scopeChanges.length
}

export function hasUnderScopeVerdict(telemetry: ScopeTelemetry): boolean {
  return telemetry.reviewerVerdict === "under_scoped"
}

export function hasOverScopeVerdict(telemetry: ScopeTelemetry): boolean {
  return telemetry.reviewerVerdict === "over_scoped"
}

export * as Telemetry from "./telemetry"
