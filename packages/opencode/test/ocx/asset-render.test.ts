import { describe, expect, test } from "bun:test"
import { AssetPipeline } from "../../src/ocx/asset-pipeline"
import { RenderOracle } from "../../src/ocx/render-oracle"

describe("asset-pipeline", () => {
  test("rejects hotlink plans, relative escapes, and missing alt", () => {
    const errors = AssetPipeline.validateManifest([
      { url: "https://images.unsplash.com/photo-1?w=100", dest: "assets/images/hero.jpg", alt: "Modern concrete house at dusk" },
      { url: "https://example.com/x.jpg", dest: "../evil.jpg", alt: "x" },
    ])
    expect(errors.some((error) => error.includes("approved stock-photo host"))).toBe(true)
    expect(errors.some((error) => error.includes("project-relative"))).toBe(true)
    expect(errors.some((error) => error.includes("alt must describe"))).toBe(true)
  })

  test("accepts the session manifest shape", () => {
    expect(
      AssetPipeline.validateManifest([
        { url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1920&q=80", dest: "assets/images/hero-house.jpg", alt: "Modern minimalist concrete house at dusk" },
      ]),
    ).toEqual([])
  })

  test("magic check accepts JPEG and rejects text", () => {
    expect(AssetPipeline.magicValid(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), "hero.jpg")).toBe(true)
    expect(AssetPipeline.magicValid(new Uint8Array([60, 104, 116, 109, 108, 62, 0, 0, 0, 0, 0, 0]), "hero.jpg")).toBe(false)
  })
})

describe("render-oracle", () => {
  test("wait covers the longest animation plus buffer", () => {
    expect(RenderOracle.maxAnimationMs(".hero-bg img { animation: heroZoom 20s ease-in-out infinite alternate; }")).toBe(6000)
    expect(RenderOracle.maxAnimationMs(".x { animation: riseIn 1.4s ease-out both; }")).toBe(1800)
    expect(RenderOracle.maxAnimationMs("body { color: red; }")).toBe(1200)
  })

  test("web artifacts get a viewport plan", () => {
    const plan = RenderOracle.planRender("index.html", "", ["index.html", "styles.css"])
    expect(plan?.viewports).toEqual([375, 768, 1440])
    expect(plan?.asserts.length).toBeGreaterThan(0)
    expect(RenderOracle.planRender("main.ts", "", ["main.ts"])).toBeUndefined()
  })

  test("hidden hero text and overflow become findings", () => {
    const findings = RenderOracle.evaluateCaptures([
      { viewport: 1440, shotPath: "/tmp/render-1440.png", consoleErrors: [], failedRequests: [], overflowX: true, textHidden: [".hero h1"] },
    ])
    expect(findings.map((finding) => finding.id)).toContain("RENDER-OVERFLOW-X")
    expect(findings.map((finding) => finding.id)).toContain("RENDER-TEXT-HIDDEN")
  })

  test("missing browser reports unverified instead of passing", () => {
    const findings = RenderOracle.evaluateCaptures([
      { viewport: 375, consoleErrors: [], failedRequests: [], unavailable: "no headless browser on PATH" },
    ])
    expect(findings.map((finding) => finding.id)).toEqual(["RENDER-UNAVAILABLE"])
  })
})
