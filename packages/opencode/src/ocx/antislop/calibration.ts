import type { CalibrationConfig, GoodhartWarning } from "./types"

export type CalibratedThresholds = {
  readonly maxComplexity: number
  readonly maxNestingDepth: number
  readonly maxFanOut: number
  readonly minTestCoverageRatio: number
  readonly maxDuplicationSimilarity: number
  readonly minChangeSignificanceChars: number
}

export function isChangeSignificant(
  beforeCode: string,
  afterCode: string,
  minSignificanceChars = 15,
): boolean {
  const normBefore = beforeCode.replace(/\s+/g, "").replace(/;/g, "")
  const normAfter = afterCode.replace(/\s+/g, "").replace(/;/g, "")

  if (normBefore === normAfter) return false

  const diffChars = Math.abs(normAfter.length - normBefore.length)
  let changedChars = 0
  const minLen = Math.min(normBefore.length, normAfter.length)

  for (let i = 0; i < minLen; i++) {
    if (normBefore[i] !== normAfter[i]) changedChars++
  }
  changedChars += diffChars

  return changedChars >= minSignificanceChars
}

export function detectGaming(
  beforeCode: string,
  afterCode: string,
  file: string,
): readonly GoodhartWarning[] {
  const warnings: GoodhartWarning[] = []

  const beforeComments = (beforeCode.match(/\/\/.*|\/\*[\s\S]*?\*\//g) ?? []).join(" ")
  const afterComments = (afterCode.match(/\/\/.*|\/\*[\s\S]*?\*\//g) ?? []).join(" ")

  const beforeCodeOnly = beforeCode.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "").trim()
  const afterCodeOnly = afterCode.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "").trim()

  if (beforeComments.length > 50 && afterComments.length === 0 && beforeCodeOnly === afterCodeOnly) {
    const w: GoodhartWarning = {
      gamingPattern: "comment-stripping-without-refactoring",
      evidence: `${file}: Stripped ${beforeComments.length} characters of comments without improving implementation.`,
      counterMetric: "comprehensionScore",
      penalty: 0.15,
    }
    warnings.push(w)
  }

  const beforeTokens = beforeCodeOnly.match(/[a-zA-Z_$][a-zA-Z0-9_$]*|[^\s\w]/g) ?? []
  const afterTokens = afterCodeOnly.match(/[a-zA-Z_$][a-zA-Z0-9_$]*|[^\s\w]/g) ?? []

  const isStructuralIdentical =
    beforeTokens.length === afterTokens.length &&
    beforeTokens.length > 10 &&
    beforeTokens.every((t, i) => {
      const at = afterTokens[i]
      if (t === at) return true
      const isIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(t) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(at)
      return isIdentifier
    })

  const tokenDiffs = beforeTokens.filter((t, i) => t !== afterTokens[i]).length
  if (isStructuralIdentical && tokenDiffs > 0 && tokenDiffs <= Math.max(10, beforeTokens.length * 0.5)) {
    const w: GoodhartWarning = {
      gamingPattern: "cosmetic-variable-renaming",
      evidence: `${file}: Renamed identifiers (${tokenDiffs} tokens) without improving structural quality or logic.`,
      counterMetric: "semanticSignificance",
      penalty: 0.1,
    }
    warnings.push(w)
  }

  const beforeFnCount = (beforeCode.match(/function\s+|const\s+\w+\s*=\s*(?:\(.*?\)|[a-zA-Z0-9_$]+)\s*=>/g) ?? []).length
  const afterFnCount = (afterCode.match(/function\s+|const\s+\w+\s*=\s*(?:\(.*?\)|[a-zA-Z0-9_$]+)\s*=>/g) ?? []).length

  if (afterFnCount >= beforeFnCount + 2 && afterCode.length <= beforeCode.length * 1.1) {
    const helperMatch = afterCode.match(/function\s+([a-zA-Z0-9_$]+)/g)
    if (helperMatch) {
      const singleCallerHelpers = helperMatch.filter((fn) => {
        const name = fn.replace("function ", "").trim()
        const occurrences = afterCode.split(name).length - 1
        return occurrences === 2
      })
      if (singleCallerHelpers.length >= 2) {
        const w: GoodhartWarning = {
          gamingPattern: "single-caller-helper-fragmentation",
          evidence: `${file}: Split function into ${singleCallerHelpers.length} single-caller helpers to artificially reduce complexity.`,
          counterMetric: "wrapperBloat",
          penalty: 0.2,
        }
        warnings.push(w)
      }
    }
  }

  const beforeNesting = calculateMaxNesting(beforeCode)
  const afterNesting = calculateMaxNesting(afterCode)

  if (afterFnCount < beforeFnCount && afterNesting >= beforeNesting + 2 && afterNesting >= 4) {
    const w: GoodhartWarning = {
      gamingPattern: "excessive-inlining-nesting-spike",
      evidence: `${file}: Inlined functions resulting in deeply nested monolithic structure (nesting: ${afterNesting}).`,
      counterMetric: "nestingDepth",
      penalty: 0.25,
    }
    warnings.push(w)
  }

  return warnings
}

function calculateMaxNesting(code: string): number {
  let maxDepth = 0
  let currentDepth = 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") {
      currentDepth++
      if (currentDepth > maxDepth) maxDepth = currentDepth
    } else if (code[i] === "}") {
      if (currentDepth > 0) currentDepth--
    }
  }
  return maxDepth
}

export function calculateNetQualityDelta(
  nominalDelta: number,
  warnings: readonly GoodhartWarning[],
): number {
  const totalPenalties = warnings.reduce((sum, w) => sum + w.penalty, 0)
  const net = parseFloat((nominalDelta - totalPenalties).toFixed(3))
  return net
}

export function calibrateThresholds(config: CalibrationConfig): CalibratedThresholds {
  const baseStrictness = config.strictness ?? 0.8
  const maturityMultiplier =
    config.maturityLevel === "production" ? 0.8 : config.maturityLevel === "beta" ? 1.0 : 1.25

  const effective = baseStrictness / maturityMultiplier

  const thresholds: CalibratedThresholds = {
    maxComplexity: Math.max(5, Math.round(15 / effective)),
    maxNestingDepth: Math.max(3, Math.round(4 / effective)),
    maxFanOut: Math.max(5, Math.round(10 / effective)),
    minTestCoverageRatio: parseFloat((0.7 * effective).toFixed(2)),
    maxDuplicationSimilarity: parseFloat((0.85 / effective).toFixed(2)),
    minChangeSignificanceChars: Math.max(10, Math.round(15 * effective)),
  }
  return thresholds
}

export * as MetricCalibration from "./calibration"
