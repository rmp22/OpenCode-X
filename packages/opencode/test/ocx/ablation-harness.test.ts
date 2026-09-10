import { describe, expect, test } from "bun:test"

export type MechanismName =
  | "declarative_attention"
  | "epistemic_verifier"
  | "anti_flail_barrier"
  | "semantic_compaction"
  | "capability_router"

export interface AblationRun {
  mechanism: MechanismName
  enabled: boolean
  passRate: number
  avgTokens: number
  avgDurationMs: number
}

export function computeAblationImpact(runs: AblationRun[]) {
  const impacts: Record<string, { deltaPassRate: number; deltaTokens: number }> = {}
  const grouped = new Map<MechanismName, { on?: AblationRun; off?: AblationRun }>()

  for (const r of runs) {
    const entry = grouped.get(r.mechanism) ?? {}
    if (r.enabled) entry.on = r
    else entry.off = r
    grouped.set(r.mechanism, entry)
  }

  for (const [mech, pair] of grouped.entries()) {
    if (pair.on && pair.off) {
      impacts[mech] = {
        deltaPassRate: pair.on.passRate - pair.off.passRate,
        deltaTokens: pair.on.avgTokens - pair.off.avgTokens,
      }
    }
  }

  return impacts
}

describe("Mechanism Ablation Harness", () => {
  test("measures contribution of each boost mechanism", () => {
    const runs: AblationRun[] = [
      { mechanism: "declarative_attention", enabled: true, passRate: 0.92, avgTokens: 12000, avgDurationMs: 400 },
      { mechanism: "declarative_attention", enabled: false, passRate: 0.78, avgTokens: 25000, avgDurationMs: 850 },
      { mechanism: "epistemic_verifier", enabled: true, passRate: 0.95, avgTokens: 14000, avgDurationMs: 450 },
      { mechanism: "epistemic_verifier", enabled: false, passRate: 0.65, avgTokens: 16000, avgDurationMs: 500 },
      { mechanism: "anti_flail_barrier", enabled: true, passRate: 0.88, avgTokens: 11000, avgDurationMs: 380 },
      { mechanism: "anti_flail_barrier", enabled: false, passRate: 0.72, avgTokens: 28000, avgDurationMs: 1100 },
    ]

    const impacts = computeAblationImpact(runs)

    expect(impacts.declarative_attention.deltaPassRate).toBeGreaterThan(0)
    expect(impacts.declarative_attention.deltaTokens).toBeLessThan(0)

    expect(impacts.epistemic_verifier.deltaPassRate).toBeGreaterThan(0.2)
    expect(impacts.anti_flail_barrier.deltaTokens).toBeLessThan(0)
  })
})
