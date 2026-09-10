import { describe, expect, test } from "bun:test"
import { Capabilities } from "../../src/ocx/capabilities"

const risks = new Set([
  "stopEarlyTendency",
  "overexplorationTendency",
  "hallucinatedConfigurationTendency",
  "repeatedActionTendency",
])
const high = Object.fromEntries(Capabilities.CAPABILITIES.map((capability) => [capability, risks.has(capability) ? 0.1 : 0.9]))
const low = Object.fromEntries(Capabilities.CAPABILITIES.map((capability) => [capability, risks.has(capability) ? 0.9 : 0.2]))

const profile = (subjectID: string, capabilities: Record<string, number>) =>
  Capabilities.parse({ subjectID, capabilities, samples: 4, updatedAt: 1 })

describe("model capability profiles", () => {
  test("requires every bounded capability score and keeps subject IDs opaque", () => {
    expect(profile("provider/model:variant", high)).toMatchObject({ subjectID: "provider/model:variant", samples: 4 })
    expect(profile("bad===id", high)).toBeUndefined()
    expect(profile("missing", { ...high, planning: 1.2 })).toBeUndefined()
    expect(profile("missing", { planning: 0.8 })).toBeUndefined()
  })

  test("updates numeric evidence with a weighted running mean", () => {
    const current = profile("model-a", high)
    expect(current).toBeDefined()
    if (!current) return

    const next = Capabilities.update(current, { values: { planning: 0.1 }, samples: 2 }, 10)
    expect(next.capabilities.planning).toBeCloseTo((0.9 * 4 + 0.1 * 2) / 6)
    expect(next.samples).toBe(6)
    expect(next.updatedAt).toBe(10)
    expect(Capabilities.update(current, { values: { planning: 4 } })).toEqual(current)
  })

  test("ranks by task needs and uses stable ID order for equal capability matches", () => {
    const better = profile("better", high)
    const worse = profile("worse", low)
    const tiedA = profile("a", high)
    const tiedZ = profile("z", high)
    expect(better).toBeDefined()
    expect(worse).toBeDefined()
    expect(tiedA).toBeDefined()
    expect(tiedZ).toBeDefined()
    if (!better || !worse || !tiedA || !tiedZ) return

    const matches = Capabilities.rank(
      [
        { id: "z", profile: worse },
        { id: "better", profile: better },
        { id: "z-high", profile: tiedZ },
        { id: "a-high", profile: tiedA },
      ],
      { capabilities: { planning: 0.8, repeatedActionTendency: 0.3 } },
    )
    expect(matches[0]?.candidate.id).toBe("a-high")
    expect(matches.find((match) => match.candidate.id === "z")?.gaps).toContain("planning")
  })

  test("strengthens guard policy for weak planning, verification, and context profiles", () => {
    const strong = profile("strong", high)
    const weak = profile("weak", low)
    expect(strong).toBeDefined()
    expect(weak).toBeDefined()
    if (!strong || !weak) return

    expect(Capabilities.policy(strong)).toEqual({ planning: "light", review: "light", completion: "light", context: "light" })
    expect(Capabilities.policy(weak)).toEqual({ planning: "strong", review: "strong", completion: "strong", context: "strong" })
  })
})
