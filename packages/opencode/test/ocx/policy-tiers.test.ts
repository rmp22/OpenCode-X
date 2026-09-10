import { describe, expect, test } from "bun:test"
import {
  getTierConfig,
  categorizeTool,
  isToolAllowedInTier,
  resolveTierForTask,
  PolicyTierManager,
  type PolicyTier,
} from "@/ocx/governance"

describe("Policy Tiers Governance", () => {
  test("returns valid configuration for all policy tiers", () => {
    const tiers: readonly PolicyTier[] = ["minimal", "standard", "comprehensive", "strict"]
    for (const tier of tiers) {
      const config = getTierConfig(tier)
      expect(config.tier).toBe(tier)
      expect(config.maxPromptTokens).toBeGreaterThan(0)
      expect(config.maxContextTokens).toBeGreaterThan(0)
      expect(config.maxTurns).toBeGreaterThan(0)
      expect(config.allowedCategories.length).toBeGreaterThan(0)
    }
  })

  test("categorizes tools correctly", () => {
    expect(categorizeTool("read")).toBe("read")
    expect(categorizeTool("glob")).toBe("read")
    expect(categorizeTool("grep")).toBe("read")
    expect(categorizeTool("edit")).toBe("mutate")
    expect(categorizeTool("write")).toBe("mutate")
    expect(categorizeTool("bash")).toBe("execute")
    expect(categorizeTool("websearch")).toBe("external")
    expect(categorizeTool("webfetch")).toBe("external")
    expect(categorizeTool("todowrite")).toBe("administrative")
  })

  test("enforces tool category and tool blocklists per tier", () => {
    expect(isToolAllowedInTier("minimal", "read")).toBe(true)
    expect(isToolAllowedInTier("minimal", "edit")).toBe(true)
    expect(isToolAllowedInTier("minimal", "bash")).toBe(false)
    expect(isToolAllowedInTier("minimal", "websearch")).toBe(false)

    expect(isToolAllowedInTier("standard", "read")).toBe(true)
    expect(isToolAllowedInTier("standard", "edit")).toBe(true)
    expect(isToolAllowedInTier("standard", "bash")).toBe(true)
    expect(isToolAllowedInTier("standard", "websearch")).toBe(true)

    expect(isToolAllowedInTier("strict", "read")).toBe(true)
    expect(isToolAllowedInTier("strict", "edit")).toBe(true)
    expect(isToolAllowedInTier("strict", "bash")).toBe(true)
    expect(isToolAllowedInTier("strict", "websearch")).toBe(false)

    expect(isToolAllowedInTier("comprehensive", "todowrite")).toBe(true)
    expect(isToolAllowedInTier("comprehensive", "websearch")).toBe(true)
  })

  test("resolves tier based on complexity, risk, and explicit request", () => {
    expect(resolveTierForTask({ requestedTier: "minimal" })).toBe("minimal")
    expect(resolveTierForTask({ risk: "high", complexity: "low" })).toBe("strict")
    expect(resolveTierForTask({ complexity: "high", risk: "standard" })).toBe("comprehensive")
    expect(resolveTierForTask({ complexity: "low", risk: "low" })).toBe("minimal")
    expect(resolveTierForTask({})).toBe("standard")
  })

  test("PolicyTierManager manages tier state and dynamic downgrade", () => {
    const manager = new PolicyTierManager("comprehensive")
    expect(manager.currentTier).toBe("comprehensive")
    expect(manager.isToolAllowed("websearch")).toBe(true)

    const firstDowngrade = manager.downgrade()
    expect(firstDowngrade).toBe("standard")
    expect(manager.currentTier).toBe("standard")

    const secondDowngrade = manager.downgrade()
    expect(secondDowngrade).toBe("minimal")
    expect(manager.currentTier).toBe("minimal")
    expect(manager.isToolAllowed("websearch")).toBe(false)

    const thirdDowngrade = manager.downgrade()
    expect(thirdDowngrade).toBeUndefined()
    expect(manager.currentTier).toBe("minimal")

    manager.setTier("strict")
    expect(manager.currentTier).toBe("strict")
    expect(manager.downgrade()).toBeUndefined()

    expect(manager.getStageBudget("analyze")).toBe(10000)
    expect(manager.getStageBudget("unknown_stage")).toBe(8000)
  })
})
