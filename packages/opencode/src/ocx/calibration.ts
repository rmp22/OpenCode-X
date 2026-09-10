import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Record as OutcomeRecord } from "./outcome"
import type { GateOutcome, StyleGateMode } from "./style-gate"

export type StyleCalibration = {
  readonly mode: StyleGateMode
  readonly outcome: GateOutcome
  readonly reviewCount: number
  readonly rewriteCount: number
  readonly retryCount: number
  readonly violationCategories: readonly string[]
  readonly policyVersion: number
  readonly reviewPromptVersion: number
  readonly rewritePromptVersion: number
  readonly schemaVersion: number
  readonly inputChars: number
  readonly outputChars: number
  readonly latencyMs: number
  readonly invalidReviewerJson: number
  readonly protectedSpanViolation: boolean
}

export type CalibrationRecord = {
  readonly time: number
  readonly sessionID: string
  readonly tier: string
  readonly round?: number
  readonly findings: readonly { id: string; span?: string }[]
  readonly ladder?: { readonly ms: number; readonly executed: number; readonly failed: number }
  readonly practice?: { readonly hits: readonly string[]; readonly proposals: readonly string[] }
  readonly style?: StyleCalibration
  readonly outcome?: OutcomeRecord
}

export function append(dataDir: string, batch: CalibrationRecord): void {
  const dir = join(dataDir, "ocx")
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, "findings.jsonl"), `${JSON.stringify(batch)}\n`)
}

export * as Calibration from "./calibration"
