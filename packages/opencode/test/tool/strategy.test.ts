import { describe, expect, test } from "bun:test"
import { Strategy } from "../../src/session/prompt/strategy"

describe("strategy catalog", () => {
  test("loads every catalog entry", () => {
    for (const name of Strategy.STRATEGY_NAMES) {
      expect(Strategy.load(name)?.length).toBeGreaterThan(0)
    }
  })

  test("keeps Compose separate from Kotlin and Android", () => {
    expect(Strategy.STRATEGY_NAMES).toContain("compose")
    expect(Strategy.load("compose")).toContain("commonMain")
    expect(Strategy.load("compose")).toContain("Compose Multiplatform")
    expect(Strategy.load("kotlin")).not.toContain("commonMain")
  })

  test("keeps web design separate from web security", () => {
    expect(Strategy.load("web-design")).toContain("fake dashboard")
    expect(Strategy.load("web")).toContain("CORS")
  })

  test("lets the model select audit criteria", () => {
    expect(Strategy.load("audit")).toContain("Choose review axes from the user goal")
    expect(Strategy.load("audit")).toContain("not file names, extensions, or authorship guesses")
    expect(Strategy.load("audit")).toContain("source-to-artifact chain")
    expect(Strategy.load("audit")).toContain("CSS-only product abstraction")
  })

  test("keeps fonts distinct and direction-aware", () => {
    const fonts = Strategy.load("fonts")
    expect(fonts).toContain("Arial")
    expect(fonts).toContain("monospace")
    expect(fonts).toContain("Inter")
    expect(fonts).toContain("IBM Plex")
    expect(fonts).toContain("Google Fonts")
    expect(fonts).toContain("RTL")
    expect(fonts).toContain("Arabic")
    expect(fonts).toContain("typography table")
    expect(fonts).not.toContain("CORS")
    expect(fonts).not.toContain("`scrollLeft`")
  })

  test("keeps RTL guidance generic in ui and CSS-specific in web-design", () => {
    const ui = Strategy.load("ui")
    const webDesign = Strategy.load("web-design")
    expect(ui).toContain("RTL AND LTR")
    expect(ui).toContain("logical layout mechanism")
    expect(ui).toContain("no reversed Latin text")
    expect(ui).not.toContain("`margin-inline-start`")
    expect(ui).not.toContain("`scrollLeft`")
    expect(webDesign).toContain("`margin-inline-start`")
    expect(webDesign).toContain('`scrollIntoView({ inline: "nearest" })`')
    expect(webDesign).toContain("`<bdi>`")
    expect(webDesign).toContain("WOFF2")
    expect(webDesign).toContain("WCAG 1.4.12")
    expect(ui).not.toContain("WOFF2")
  })
})
