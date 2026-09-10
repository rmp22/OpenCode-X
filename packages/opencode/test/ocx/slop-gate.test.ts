import { describe, expect, test } from "bun:test"
import { OCXGate } from "../../src/ocx/slop-gate"
import { SessionDone } from "../../src/ocx/session-done"

const plantedProse = `Good. Great progress on desktop!
This seamless experience delivers a world-class booking flow.
Your inquiry has been sent. We will contact you within 24 hours.`

const plantedHtml = `
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@400&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<a href="#">Facebook</a>
<a href="#">Instagram</a>
<p>(555) 123-4567</p>
<p>123 Oceanview Drive</p>
<div class="feature-card h-100">wifi</div>
<div class="feature-card h-100">tv</div>
<div class="feature-card h-100">pool</div>
<div class="feature-card h-100">parking</div>
<div class="feature-card h-100">pets</div>
<div class="feature-card h-100">kitchen</div>
`

const plantedCss = `
.hero-overlay {
  background: linear-gradient(135deg, rgba(0,0,0,.5), rgba(0,0,0,.3));
}
.feature-card:hover {
  transform: translateY(-5px);
}
section h2::after {
  content: "";
  position: absolute;
  bottom: 0;
  width: 60px;
  height: 3px;
  background-color: var(--color-primary);
}
h1 {
  font-family: 'Playfair Display', serif;
}
body {
  font-family: 'Lato', sans-serif;
}
`

const cleanSample = `Booking requests post to POST /api/inquiries and show success only on HTTP 201.
The page lists three sections with different layouts: one full-bleed photo section,
one price table, one availability calendar. Body text is 16px with 4.5:1 contrast.
Fonts: Fraunces for display and Source Sans 3 for reading, both OFL, chosen for
the warm editorial register of the brand.`

describe("slop gate", () => {
  test("flags every banned pattern family in a planted sample", () => {
    const findings = [...OCXGate.scanText(plantedProse), ...OCXGate.scanText(`${plantedHtml}\n${plantedCss}`)]
    const rules = new Set(findings.map((finding) => finding.rule))
    for (const rule of [
      "SELF_CHEER",
      "HYPE_WORD",
      "FAKE_SUCCESS",
      "DEAD_LINKS",
      "PLACEHOLDER_CONTACT",
      "EQUAL_CARDS",
      "DECORATIVE_GRADIENT",
      "HOVER_BOUNCE",
      "HEADING_UNDERLINE_DECOR",
      "DEFAULT_FONT_PAIRING",
    ]) {
      expect(rules.has(rule)).toBe(true)
    }
    const fakeSuccess = findings.find((finding) => finding.rule === "FAKE_SUCCESS")
    expect(fakeSuccess?.severity).toBe("blocker")
  })

  test("passes a clean sample with zero findings", () => {
    expect(OCXGate.scanText(cleanSample)).toEqual([])
    expect(OCXGate.scanText(plantedCss.replace("linear-gradient(135deg", "none"))).not.toContain(
      OCXGate.scanText(plantedCss).find((finding) => finding.rule === "DECORATIVE_GRADIENT"),
    )
  })

  test("caps and dedupes findings", () => {
    const spammy = `${plantedProse}\n${plantedProse.repeat(6)}`
    const findings = OCXGate.scanText(spammy)
    expect(findings.length).toBeLessThanOrEqual(12)
    const rules = findings.map((finding) => finding.rule)
    expect(new Set(rules).size).toBe(rules.length)
  })

  test("renders a directive block only when findings exist", () => {
    expect(OCXGate.directive([])).toBeUndefined()
    const rendered = OCXGate.directive(OCXGate.scanText(plantedProse))
    expect(rendered).toContain("=== OCX OUTPUT GATE ===")
    expect(rendered).toContain("FAKE_SUCCESS")
    expect(rendered).toContain("=== END OCX OUTPUT GATE ===")
  })

  test("scopes the scan to assistant output after the last user message", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "build the page" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Old turn claimed a seamless world-class result." }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: cleanSample }] },
      { info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash" }] },
    ]
    expect(OCXGate.gateDirectiveFromMessages(messages)).toBeUndefined()
  })

  test("emits a directive when current-turn output trips the gate", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "build the page" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: `${plantedProse} ${cleanSample}` }] },
    ]
    const rendered = OCXGate.gateDirectiveFromMessages(messages)
    expect(rendered).toContain("SELF_CHEER")
    expect(rendered).toContain("FAKE_SUCCESS")
  })

  test("ignores tiny outputs", () => {
    const messages = [{ info: { role: "user" }, parts: [{ type: "text", text: "hi there" }] }, { info: { role: "assistant" }, parts: [{ type: "text", text: "Good." }] }]
    expect(OCXGate.gateDirectiveFromMessages(messages)).toBeUndefined()
  })
})

describe("session-derived oracles", () => {
  test("flags the unverified asset claim pattern", () => {
    const reply =
      "These are all real Unsplash photo URLs that show residential interiors and exteriors, directly relevant to the property listings."
    const rules = OCXGate.scanText(reply).map((finding) => finding.rule)
    expect(rules).toContain("UNVERIFIED_ASSET_CLAIM")
  })

  test("does not flag honest verification language", () => {
    const clean =
      "I will download the images from Unsplash into assets/ and verify each URL loads before shipping."
    expect(OCXGate.scanText(clean).some((f) => f.rule === "UNVERIFIED_ASSET_CLAIM")).toBe(false)
  })

  test("scanArtifact flags hot-linked stock images in delivered html", () => {
    const lines = [
      '<img src="https://images.pexels.com/photos/276748/pexels-photo-276748.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop" alt="interior">',
      '<img src="https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&w=1920&fit=crop" alt="living room">',
    ]
    const rules = OCXGate.scanArtifact(lines.join("\n")).map((finding) => finding.rule)
    expect(rules).toContain("HOTLINKED_IMAGES")
    expect(rules).not.toContain("P-arrows")
  })

  test("scanArtifact leaves local assets and code prose alone", () => {
    const lines = ['<img src="assets/hero.jpg" alt="hero">', "const next = items.map((item) => item.id); a -> b"]
    expect(OCXGate.scanArtifact(lines.join("\n"))).toEqual([])
  })
})

describe("reasoning thrash guard", () => {
  const message = (role: string, parts: { type: string; text?: string }[]) => ({
    info: { role },
    parts,
  })

  test("nudges when reasoning cycles past the threshold", () => {
    const cycling = Array(8).fill("Actually, let me try a different approach.").join(" ")
    const feedback = OCXGate.reasoningThrashFeedback([message("assistant", [{ type: "reasoning", text: cycling }])])
    expect(feedback).toContain("OCX REASONING GUARD")
    expect(feedback).toContain("fallback")
  })

  test("stays silent for healthy deliberation and non-reasoning text", () => {
    const calm = "First check the callers, then read the schema, then decide."
    expect(
      OCXGate.reasoningThrashFeedback([message("assistant", [{ type: "reasoning", text: calm }])]),
    ).toBeUndefined()
    expect(
      OCXGate.reasoningThrashFeedback([message("assistant", [{ type: "text", text: "actually wait let me try".repeat(8) }])]),
    ).toBeUndefined()
  })
})

describe("duplicate photo guard", () => {
  test("flags one stock photo reused across sections via crop variants", () => {
    const html = [
      '<img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&h=1067&fit=crop" alt="a">',
      '<img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&h=800&fit=crop" alt="b">',
      '<img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&h=750&fit=crop" alt="c">',
    ].join("\n")
    const hit = OCXGate.scanArtifact(html).find((finding) => finding.rule === "DUPLICATE_PHOTO")
    expect(hit?.evidence).toContain("photo-1600585154340-be6161a56a0c x3")
  })

  test("stays silent for distinct photos and local assets", () => {
    const html = [
      '<img src="/assets/hero.jpg" alt="a">',
      '<img src="/assets/kitchen.jpg" alt="b">',
      '<img src="https://images.unsplash.com/photo-a?w=800" alt="c">',
      '<img src="https://images.unsplash.com/photo-b?w=800" alt="d">',
    ].join("\n")
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "DUPLICATE_PHOTO")).toBe(false)
  })
})

describe("dead image service", () => {
  test("blocks source.unsplash.com links as broken by default", () => {
    const html = '<img src="https://source.unsplash.com/800x600/?studio-apartment,interior" alt="studio">'
    const hit = OCXGate.scanArtifact(html).find((finding) => finding.rule === "DEAD_IMAGE_SERVICE")
    expect(hit?.severity).toBe("blocker")
  })
})


describe("asset pipeline hardening", () => {
  test("hot-linked stock images are blockers, not warnings", () => {
    const html = '<img src="https://images.pexels.com/photos/276748/pexels-photo-276748.jpeg?w=800" alt="x">'
    const hit = OCXGate.scanArtifact(html).find((finding) => finding.rule === "HOTLINKED_IMAGES")
    expect(hit?.severity).toBe("blocker")
  })

  test("dead image service and hotlinking fire together on stock-photo pages", () => {
    const html = [
      '<img src="https://source.unsplash.com/800x600/?penthouse,interior" alt="a">',
      '<img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&h=1067&fit=crop" alt="b">',
      '<img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&h=800&fit=crop" alt="c">',
      '<img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&h=750&fit=crop" alt="d">',
    ].join("\n")
    const rules = OCXGate.scanArtifact(html)
    expect(rules.find((f) => f.rule === "DEAD_IMAGE_SERVICE")?.severity).toBe("blocker")
    expect(rules.some((f) => f.rule === "DUPLICATE_PHOTO")).toBe(true)
  })
})


describe("community slop cluster", () => {
  test("flags the glassmorphism cluster but not a single nav blur", () => {
    const cluster = Array(3).fill(".card { backdrop-filter: blur(12px); }").join("\n")
    expect(OCXGate.scanArtifact(cluster).some((f) => f.rule === "GLASSMORPHISM_CLUSTER")).toBe(true)
    expect(OCXGate.scanArtifact(".nav { backdrop-filter: blur(8px); }").some((f) => f.rule === "GLASSMORPHISM_CLUSTER")).toBe(false)
  })

  test("flags emoji standing in for icons", () => {
    const house = String.fromCodePoint(0x1f3e0)
    const html = `<link rel="icon" href="data:image/svg+xml,<text>${house}</text>"> <span>${house}</span>`
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "EMOJI_AS_ICON")).toBe(true)
  })


  test("flags the Playfair Display + Inter reflex pairing", () => {
    const html = '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400&display=swap" rel="stylesheet">'
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "DEFAULT_FONT_PAIRING")).toBe(true)
  })
})

describe("token drift", () => {
  test("flags a real near-duplicate accent pair", () => {
    const css = "--gold: #e0b34a; --gold-2: #d4a342;"
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "TOKEN_DRIFT")).toBe(true)
  })

  test("stays silent for neutral ramps and distinct hues", () => {
    const css = ["--a: #1a1a1f;", "--b: #22222a;", "--c: #e0b34a;", "--d: #3584e4;"].join("\n")
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "TOKEN_DRIFT")).toBe(false)
  })

  test("does not flag close channels from different hue families", () => {
    const css = "--sage: #84a98c; --teal: #7fa8a0;"
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "TOKEN_DRIFT")).toBe(false)
  })

  test("treats hues across the red wraparound as one family", () => {
    const css = "--red-1: #e74c3c; --red-2: #d63b2f;"
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "TOKEN_DRIFT")).toBe(true)
  })
})


describe("typography slop cluster", () => {
  test("flags uniform centered headings pattern in markup", () => {
    const html = [
      '<section><h2 style="text-align:center">A</h2></section>',
      '<section><h2 style="text-align:center">B</h2></section>',
      '<section><h2 style="text-align:center">C</h2></section>',
      '<section><h2 style="text-align:center">D</h2></section>',
      '<section><h2 style="text-align:center">E</h2></section>',
    ].join("\n")
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "UNIFORM_CENTERED_HEADINGS")).toBe(true)
  })

  test("stays silent for varied alignment", () => {
    const html = [
      '<section><h2>A</h2></section>',
      '<section><h2 style="text-align:center">B</h2></section>',
      '<section><h2>C</h2></section>',
    ].join("\n")
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "UNIFORM_CENTERED_HEADINGS")).toBe(false)
  })
})

describe("font size ramp", () => {
  test("flags pages declaring seven or more ad-hoc sizes", () => {
    const css = Array.from({ length: 8 }, (_, i) => `.s${i} { font-size: ${0.75 + i * 0.125}rem; }`).join("\n")
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "FONT_SIZE_DRIFT")).toBe(true)
  })

  test("passes a proper ramp", () => {
    const css = [".d { font-size: 3rem; }", ".h { font-size: 1.875rem; }", ".b { font-size: 1rem; }", ".c { font-size: 0.875rem; }"].join("\n")
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "FONT_SIZE_DRIFT")).toBe(false)
  })
})

describe("output style gate", () => {
  test("flags service endings, hedges, apology loops, emoji floods, and bold walls", () => {
    const reply = [
      "Great, the export works.",
      "**Fast.** **Reliable.** **Secure.** **Simple.** **Proven.** **Modern.** **Clean.** **Safe.** **Solid.** **Smart.**",
      "It is worth noting that the CLI also supports JSON output.",
      "Sorry for the delay. Sorry again. I'm sorry this took long.",
      "Hope this helps! Let me know if you would like me to explain more \u{1F600} \u{1F680} \u{2728} \u{1F44D}",
    ].join("\n")
    const rules = OCXGate.scanText(reply).map((finding) => finding.rule)
    expect(rules).toContain("S-engagement-bait")
    expect(rules).toContain("S-filler-hedge")
    expect(rules).toContain("S-apology-loop")
    expect(rules).toContain("S-emoji-prose")
    expect(rules).toContain("S-bold-overload")
  })

  test("passes direct prose with one apology and no decoration", () => {
    const reply =
      "Retry budget: 3 attempts with backoff. Sorry for the earlier miscount; fixed in config.ts:12."
    expect(OCXGate.scanText(reply).some((finding) => finding.rule.startsWith("S-"))).toBe(false)
  })

  test("never applies style rules to delivered artifacts", () => {
    const artifact = [
      '<p>Hope this helps! It is worth noting that **bold** works.</p>',
      "<span>\u{1F600} \u{1F680} \u{2728} \u{1F44D}</span>",
    ].join("\n")
    expect(OCXGate.scanArtifact(artifact).some((finding) => finding.rule.startsWith("S-"))).toBe(false)
  })
})

describe("session done marker", () => {  test("detects the declared done state in final replies", () => {
    expect(SessionDone.declaresDone("VERIFY: DEPTH:standard STATE:done")).toBe(true)
    expect(SessionDone.declaresDone("state: DONE")).toBe(true)
    expect(SessionDone.declaresDone("STATE: needs_input")).toBe(false)
    expect(SessionDone.declaresDone("done working on this STATE machine")).toBe(false)
  })

  test("detects the declared needs-input state", () => {
    expect(SessionDone.declaresNeedsInput("PHASE: answer DEPTH: concise STATE: needs_input")).toBe(true)
    expect(SessionDone.declaresNeedsInput("STATE: done")).toBe(false)
  })
})

describe("capability orientation injection", () => {
  test("pipeline directives carry bounded orientation instead of a craft dump", async () => {
    const { OCXPipeline } = await import("../../src/ocx/ocx-pipeline")
    const result: Parameters<typeof OCXPipeline.directives>[0] = {
      changed: false,
      polished: "build a thing",
      strategies: [],
      workflow: { name: "codegen", phase: "context", phases: [] },
      notice: undefined,
    }
    const parts = OCXPipeline.directives(result)
    const orientation = parts.find((p) => p.includes("OCX orientation:"))
    expect(orientation).toBeDefined()
    expect(parts.some((part) => part.includes("OCX CRAFT KNOWLEDGE"))).toBe(false)
  })
})

describe("remote font css gate", () => {
  test("flags google fonts and material icon CDNs", () => {
    const html = [
      '<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">',
      '<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">',
    ].join("\n")
    const hit = OCXGate.scanArtifact(html).find((f) => f.rule === "REMOTE_FONT_CSS")
    expect(hit?.severity).toBe("warning")
    expect(hit?.evidence).toContain("fonts.googleapis.com")
  })

  test("stays silent for vendored fonts", () => {
    const html = '<link rel="stylesheet" href="/assets/fonts/inter.css">'
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "REMOTE_FONT_CSS")).toBe(false)
  })
})

describe("decorative gradients", () => {
  test("flags linear gradients at any angle and radial gradients", () => {
    const css = [
      ".a { background: linear-gradient(90deg, #111111, #333333); }",
      ".b { background: radial-gradient(circle, #111111, transparent); }",
      ".c { background: linear-gradient(to bottom, rgba(0,0,0,.6), rgba(0,0,0,.2)); }",
    ].join("\n")
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "DECORATIVE_GRADIENT")).toBe(true)
    expect(
      OCXGate.scanArtifact(".b { background: radial-gradient(circle, #111111, transparent); }").some(
        (f) => f.rule === "DECORATIVE_GRADIENT",
      ),
    ).toBe(true)
  })

  test("stays silent for flat overlays", () => {
    const css = ".hero { background: rgba(0,0,0,.45); }"
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "DECORATIVE_GRADIENT")).toBe(false)
  })
})

describe("kicker title formula", () => {
  test("flags three or more repeated kicker-plus-heading pairs", () => {
    const html = Array.from({ length: 3 }, (_, i) =>
      `<section><p class="kicker">Section ${i}</p><h2>Title ${i}</h2></section>`,
    ).join("\n")
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "KICKER_TITLE_FORMULA")).toBe(true)
  })

  test("allows one or two kickers before a heading", () => {
    const html = '<section><p class="eyebrow">Only one</p><h2>Title</h2></section>'
    expect(OCXGate.scanArtifact(html).some((f) => f.rule === "KICKER_TITLE_FORMULA")).toBe(false)
  })
})

describe("form label treatment", () => {
  test("flags oversized and display-font labels", () => {
    const css = [
      "label { font-size: 2rem; }",
      ".signup label { font-family: 'Playfair Display', serif; }",
    ].join("\n")
    const findings = OCXGate.scanArtifact(css).filter((f) => f.rule === "FORM_LABEL_HEADING_TREATMENT")
    expect(findings).toHaveLength(1)
    expect(findings[0].evidence).toContain("label")
  })

  test("passes reading-size labels in the body face", () => {
    const css = "label { font-size: 0.875rem; font-family: 'Source Sans 3', sans-serif; }"
    expect(OCXGate.scanArtifact(css).some((f) => f.rule === "FORM_LABEL_HEADING_TREATMENT")).toBe(false)
  })
})
