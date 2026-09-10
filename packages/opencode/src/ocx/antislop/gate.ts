import type {
  CalibrationConfig,
  GoodhartWarning,
  RefactorTriggerResult,
  SlopFinding,
  StructuralErosionHotspot,
  TrajectoryAnalysis,
  TurnAttribution,
  TurnQualityRecord,
  VerbositySignal,
} from "./types"
import { analyzeTrajectory } from "./trajectory"
import { attributeDiff } from "./attribution"
import { analyzeFileErosion } from "./erosion"
import { detectDuplication, scanVerbositySignals } from "./verbosity"
import { detectGaming } from "./calibration"
import { evaluateRefactorTriggers } from "./refactor-trigger"
import { FindingDeduplicator } from "./dedup"

export type GateDecision = "PASS" | "WARN" | "BLOCK"

export type UnifiedGateInput = {
  readonly diff?: string
  readonly files?: Record<string, string>
  readonly beforeFiles?: Record<string, string>
  readonly turn?: number
  readonly staticFindings?: readonly SlopFinding[]
  readonly calibration?: CalibrationConfig
  readonly trajectoryHistory?: readonly TurnQualityRecord[]
  readonly earlyExitOnBlocker?: boolean
}

export type UnifiedGateOutput = {
  readonly decision: GateDecision
  readonly passed: boolean
  readonly score: number
  readonly blockers: readonly SlopFinding[]
  readonly warnings: readonly SlopFinding[]
  readonly reasons: readonly string[]
  readonly trajectory?: TrajectoryAnalysis
  readonly attribution?: TurnAttribution
  readonly hotspots: readonly StructuralErosionHotspot[]
  readonly verbositySignals: readonly VerbositySignal[]
  readonly goodhartWarnings: readonly GoodhartWarning[]
  readonly refactorTriggers?: RefactorTriggerResult
  readonly feedbackSummary?: string
  readonly executionTimeMs: number
}

export class SlopRegressionGate {
  private readonly deduplicator = new FindingDeduplicator()

  evaluate(input: UnifiedGateInput): UnifiedGateOutput {
    const startTime = performance.now()
    const turn = input.turn ?? 1
    const reasons: string[] = []
    const blockers: SlopFinding[] = []
    const warnings: SlopFinding[] = []

    if (input.staticFindings) {
      for (const f of input.staticFindings) {
        if (f.severity === "blocker") {
          blockers.push(f)
        } else if (f.severity === "warning") {
          warnings.push(f)
        }
      }
    }

    if (input.earlyExitOnBlocker && blockers.length > 0) {
      const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2))
      const earlyOut: UnifiedGateOutput = {
        decision: "BLOCK",
        passed: false,
        score: 0.0,
        blockers,
        warnings,
        reasons: ["Early exit triggered by static blocker findings."],
        hotspots: [],
        verbositySignals: [],
        goodhartWarnings: [],
        executionTimeMs,
      }
      return earlyOut
    }

    let attribution: TurnAttribution | undefined
    if (input.diff) {
      attribution = attributeDiff(input.diff, { turn })
    }

    let trajectory: TrajectoryAnalysis | undefined
    if (input.trajectoryHistory && input.trajectoryHistory.length > 0) {
      trajectory = analyzeTrajectory(input.trajectoryHistory)
    }

    const goodhartWarnings: GoodhartWarning[] = []
    if (input.files && input.beforeFiles) {
      for (const [file, afterCode] of Object.entries(input.files)) {
        const beforeCode = input.beforeFiles[file]
        if (beforeCode) {
          const gw = detectGaming(beforeCode, afterCode, file)
          goodhartWarnings.push(...gw)
        }
      }
    }

    const verbositySignals: VerbositySignal[] = []
    if (input.files) {
      const dupSignals = detectDuplication(input.files)
      verbositySignals.push(...dupSignals)

      for (const [file, code] of Object.entries(input.files)) {
        const fileSignals = scanVerbositySignals(file, code)
        verbositySignals.push(...fileSignals)
      }
    }

    for (const v of verbositySignals) {
      if (v.severity === "blocker") {
        blockers.push({
          id: `v-${v.rule}`,
          rule: v.rule,
          severity: "blocker",
          file: v.target,
          evidence: v.evidence,
          fix: v.fix,
        })
      } else if (v.severity === "warning") {
        warnings.push({
          id: `v-${v.rule}`,
          rule: v.rule,
          severity: "warning",
          file: v.target,
          evidence: v.evidence,
          fix: v.fix,
        })
      }
    }

    const hotspots: StructuralErosionHotspot[] = []
    if (input.files) {
      for (const [file, code] of Object.entries(input.files)) {
        const lineCount = code.split("\n").length
        const obs = [
          {
            turn,
            file,
            state: { lineCount, outgoingDependencies: 2 },
            modified: true,
          },
        ]
        const hotspot = analyzeFileErosion(file, obs, turn)
        if (hotspot.compositeErosionScore > 0.4) {
          hotspots.push(hotspot)
        }
      }
    }

    const allFindings = [...blockers, ...warnings]
    const feedback = this.deduplicator.processTurn(turn, allFindings)

    const escalatedBlockers = feedback.topFindings.filter((f) => f.escalatedToBlocker)
    for (const eb of escalatedBlockers) {
      if (!blockers.some((b) => b.id === eb.fingerprint)) {
        blockers.push({
          id: eb.fingerprint,
          rule: eb.rule,
          severity: "blocker",
          file: eb.file,
          line: eb.line,
          evidence: eb.evidence,
          fix: eb.fix,
        })
      }
    }

    const totalGoodhartPenalty = goodhartWarnings.reduce((sum, w) => sum + w.penalty, 0)

    let isBlocked = false
    let isWarn = false

    if (blockers.length > 0) {
      isBlocked = true
      reasons.push(`${blockers.length} hard blocker finding(s) detected`)
    }

    if (trajectory?.circuitBreakerTriggered) {
      isBlocked = true
      reasons.push(
        `Circuit breaker triggered: ${trajectory.consecutiveDegradingTurns} consecutive degrading turns`,
      )
    }

    const severeHotspot = hotspots.find((h) => h.compositeErosionScore > 0.7 && h.isCritical)
    if (severeHotspot) {
      isBlocked = true
      reasons.push(
        `Critical module ${severeHotspot.file} has severe structural erosion score (${severeHotspot.compositeErosionScore})`,
      )
    }

    if (totalGoodhartPenalty > 0.3) {
      isBlocked = true
      reasons.push(
        `Goodhart gaming penalty (${totalGoodhartPenalty.toFixed(2)}) exceeds threshold 0.30`,
      )
    }

    if (!isBlocked) {
      if (warnings.length > 0) {
        isWarn = true
        reasons.push(`${warnings.length} warning finding(s) require review`)
      }
      if (trajectory?.classification === "DEGRADING") {
        isWarn = true
        reasons.push(`Trajectory is DEGRADING (ΔQ = ${trajectory.deltaQ.toFixed(3)})`)
      }
      const moderateHotspot = hotspots.find((h) => h.compositeErosionScore > 0.5)
      if (moderateHotspot) {
        isWarn = true
        reasons.push(
          `Module ${moderateHotspot.file} has elevated erosion score (${moderateHotspot.compositeErosionScore})`,
        )
      }
      if (totalGoodhartPenalty > 0) {
        isWarn = true
        reasons.push(`Goodhart gaming detected (penalty: ${totalGoodhartPenalty.toFixed(2)})`)
      }
    }

    const decision: GateDecision = isBlocked ? "BLOCK" : isWarn ? "WARN" : "PASS"
    const passed = decision === "PASS"

    let calculatedScore = 1.0
    calculatedScore -= blockers.length * 0.4
    calculatedScore -= warnings.length * 0.05
    if (trajectory?.classification === "DEGRADING") calculatedScore -= 0.15
    calculatedScore -= totalGoodhartPenalty
    const score = parseFloat(Math.max(0.0, Math.min(1.0, calculatedScore)).toFixed(2))

    const refactorTriggers = evaluateRefactorTriggers({
      hotspots,
      duplicationSignals: verbositySignals,
      trajectory,
      attribution,
    })

    const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2))

    const output: UnifiedGateOutput = {
      decision,
      passed,
      score,
      blockers,
      warnings,
      reasons,
      trajectory,
      attribution,
      hotspots,
      verbositySignals,
      goodhartWarnings,
      refactorTriggers,
      feedbackSummary: feedback.formattedFeedback,
      executionTimeMs,
    }
    return output
  }
}

export * as UnifiedSlopGate from "./gate"
