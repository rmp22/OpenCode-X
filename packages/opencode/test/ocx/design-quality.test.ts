import { describe, expect, test } from "bun:test"
import { DesignIntent } from "../../src/ocx/design"
import { DesignSystem } from "../../src/ocx/design"
import { HumanReference } from "../../src/ocx/design"

describe("OCX design quality defaults", () => {
  test("preserves minimal decoration instead of collapsing it to none", () => {
    expect(DesignIntent.classifyIntent({ decoration: "minimal" }).decoration).toBe("minimal")
  })

  test("uses a usable mobile content width", () => {
    const adapted = DesignSystem.adaptDesignSystem(DesignSystem.createDefaultDesignSystem(), {
      density: "medium",
      platform: "mobile",
      character: "functional",
    })
    expect(adapted.layout.maxWidth).toBeGreaterThanOrEqual(375)
  })

  test("luxury theme is not synonymous with glassmorphism", () => {
    const luxury = HumanReference.getThemeSeeds().find((seed) => seed.name === "Luxury")
    expect(luxury?.surfaceStrategy).not.toBe("glass")
    expect(luxury?.elevation).not.toBe("deep")
  })
})
