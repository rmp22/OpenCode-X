export type FindingCount = { readonly id: string; readonly count: number }

export type StyleMetricsSummary = {
  readonly reviewPass: number
  readonly reviewFail: number
  readonly rewriteCandidates: number
  readonly rewriteApplied: number
  readonly verificationPass: number
  readonly verificationFail: number
  readonly hardBlock: number
  readonly reviewUnavailable: number
  readonly invalidReviewerJson: number
  readonly protectedSpanViolation: number
  readonly violationCategories: readonly FindingCount[]
  readonly avgInputChars?: number
  readonly avgOutputChars?: number
  readonly avgLatencyMs?: number
}

export type MetricsSummary = {
  readonly records: number
  readonly closedClean: number
  readonly blocked: number
  readonly topFindings: readonly FindingCount[]
  readonly medianRounds?: number
  readonly avgLadderMs?: number
  readonly practiceHitPacks?: readonly FindingCount[]
  readonly practiceProposals?: number
  readonly style?: StyleMetricsSummary
}

type Line = {
  round?: unknown
  findings?: unknown
  ladder?: { ms?: unknown; executed?: unknown; failed?: unknown }
  practice?: { hits?: unknown; proposals?: unknown }
  style?: {
    mode?: unknown
    outcome?: unknown
    reviewCount?: unknown
    rewriteCount?: unknown
    retryCount?: unknown
    violationCategories?: unknown
    inputChars?: unknown
    outputChars?: unknown
    latencyMs?: unknown
    invalidReviewerJson?: unknown
    protectedSpanViolation?: unknown
  }
}

function parseLine(raw: string): Line | undefined {
  try {
    const parsed = JSON.parse(raw) as Line
    if (typeof parsed !== "object" || parsed === null) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function roundsOf(records: readonly Line[]): number[] {
  return records
    .map((record) => record.round)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b)
}

function median(sorted: readonly number[]): number | undefined {
  if (sorted.length === 0) return undefined
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function aggregate(lines: readonly string[]): MetricsSummary {
  const records = lines.map(parseLine).filter((line): line is Line => line !== undefined)
  const histogram = new Map<string, number>()
  const practiceHistogram = new Map<string, number>()
  let ladderSum = 0
  let ladderSamples = 0
  let practiceProposals = 0
  const styleCategories = new Map<string, number>()
  let styleReviewPass = 0
  let styleReviewFail = 0
  let styleRewriteCandidates = 0
  let styleRewriteApplied = 0
  let styleVerificationPass = 0
  let styleVerificationFail = 0
  let styleHardBlock = 0
  let styleReviewUnavailable = 0
  let styleInvalidJson = 0
  let styleProtectedSpanViolation = 0
  let styleInputChars = 0
  let styleOutputChars = 0
  let styleLatencyMs = 0
  let styleSamples = 0
  for (const record of records) {
    if (Array.isArray(record.findings)) {
      for (const finding of record.findings) {
        if (typeof finding?.id !== "string") continue
        histogram.set(finding.id, (histogram.get(finding.id) ?? 0) + 1)
      }
    }
    if (typeof record.ladder?.ms === "number" && Number.isFinite(record.ladder.ms)) {
      ladderSum += record.ladder.ms
      ladderSamples++
    }
    if (Array.isArray(record.practice?.hits))
      for (const pack of record.practice.hits) {
        if (typeof pack !== "string" || !pack) continue
        practiceHistogram.set(pack, (practiceHistogram.get(pack) ?? 0) + 1)
      }
    if (Array.isArray(record.practice?.proposals))
      practiceProposals += record.practice.proposals.filter(
        (proposal) => typeof proposal === "string" && proposal.length > 0,
      ).length
    const style = record.style
    if (style && typeof style.outcome === "string") {
      styleSamples++
      if (style.outcome === "pass" || style.outcome === "pass_after_rewrite") styleReviewPass++
      else styleReviewFail++
      if (typeof style.rewriteCount === "number" && style.rewriteCount > 0) styleRewriteCandidates++
      if (style.outcome === "pass_after_rewrite") styleRewriteApplied++
      if (typeof style.reviewCount === "number" && style.reviewCount >= 2) {
        if (style.outcome === "pass_after_rewrite") styleVerificationPass++
        else styleVerificationFail++
      }
      if (style.outcome === "block_hard_violation") styleHardBlock++
      if (style.outcome === "review_unavailable") styleReviewUnavailable++
      if (typeof style.invalidReviewerJson === "number" && Number.isFinite(style.invalidReviewerJson))
        styleInvalidJson += style.invalidReviewerJson
      if (style.protectedSpanViolation === true) styleProtectedSpanViolation++
      if (Array.isArray(style.violationCategories))
        for (const category of style.violationCategories) {
          if (typeof category !== "string" || !category) continue
          styleCategories.set(category, (styleCategories.get(category) ?? 0) + 1)
        }
      if (typeof style.inputChars === "number" && Number.isFinite(style.inputChars)) styleInputChars += style.inputChars
      if (typeof style.outputChars === "number" && Number.isFinite(style.outputChars))
        styleOutputChars += style.outputChars
      if (typeof style.latencyMs === "number" && Number.isFinite(style.latencyMs)) styleLatencyMs += style.latencyMs
    }
  }
  const topFindings = [...histogram]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ id, count }))
  const practiceHitPacks = [...practiceHistogram]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([id, count]) => ({ id, count }))
  const ladders = records.filter((record) => typeof record.ladder?.executed === "number")
  const styleCategoryCounts = [...styleCategories]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([id, count]) => ({ id, count }))
  const style =
    styleSamples === 0
      ? undefined
      : {
          reviewPass: styleReviewPass,
          reviewFail: styleReviewFail,
          rewriteCandidates: styleRewriteCandidates,
          rewriteApplied: styleRewriteApplied,
          verificationPass: styleVerificationPass,
          verificationFail: styleVerificationFail,
          hardBlock: styleHardBlock,
          reviewUnavailable: styleReviewUnavailable,
          invalidReviewerJson: styleInvalidJson,
          protectedSpanViolation: styleProtectedSpanViolation,
          violationCategories: styleCategoryCounts,
          ...(styleInputChars > 0 ? { avgInputChars: Math.round(styleInputChars / styleSamples) } : {}),
          ...(styleOutputChars > 0 ? { avgOutputChars: Math.round(styleOutputChars / styleSamples) } : {}),
          ...(styleLatencyMs > 0 ? { avgLatencyMs: Math.round(styleLatencyMs / styleSamples) } : {}),
        }
  return {
    records: records.length,
    closedClean: records.filter(
      (record) => Array.isArray(record.findings) && record.findings.length === 0 && typeof record.round === "number",
    ).length,
    blocked: records.filter((record) => Array.isArray(record.findings) && record.findings.length > 0).length,
    topFindings,
    ...(roundsOf(records).length > 0 ? { medianRounds: median(roundsOf(records)) } : {}),
    ...(ladderSamples > 0 ? { avgLadderMs: Math.round(ladderSum / ladderSamples) } : {}),
    ...(practiceHitPacks.length > 0 ? { practiceHitPacks } : {}),
    ...(practiceProposals > 0 ? { practiceProposals } : {}),
    ...(style ? { style } : {}),
  }
}

export * as Metrics from "./metrics"
