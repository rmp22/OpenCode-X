import { describe, expect, test } from "bun:test"
import { ExitGate } from "../../src/ocx/exit-gate"
import { scanText } from "../../src/ocx/slop-gate"

const base = {
  reply: "Done.",
  entries: [
    { kind: "read", path: "/a/x.ts" },
    { kind: "edit", path: "/a/x.ts" },
    { kind: "command", command: "bun test", outcome: "passed", check: "test" },
  ] as const,
  openTodos: [],
  tier: "quick",
} as const

describe("added comment check C14", () => {
  test("flags commented-out code on changed files", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([["/a/x.ts", ["const ok = 1", "// const dead = true"]]]),
    })
    const hits = findings.filter((finding) => finding.id === "C14-added-comment")
    expect(hits.length).toBe(1)
    expect(hits[0].span).toContain("const dead")
  })

  test("pragmas are exempt", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([["/a/x.ts", ["// oxlint-disable-next-line no-self-assign", "const ok = 1"]]]),
    })
    expect(findings.filter((finding) => finding.id === "C14-added-comment")).toEqual([])
  })

  test("caps at three findings per turn", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([
         ["/a/one.ts", ["// const a = 1"]],
         ["/a/two.ts", ["// const b = 1"]],
         ["/a/three.ts", ["// const c = 1"]],
         ["/a/four.ts", ["// const d = 1"]],
      ]),
    })
    expect(findings.filter((finding) => finding.id === "C14-added-comment").length).toBe(3)
  })

  test("hash comments count too", () => {
    const findings = ExitGate.evaluate({
      ...base,
       added: new Map([["/a/app.py", ["# for row in rows:", "print(row)"]]]),
    })
    expect(findings.map((finding) => finding.id)).toContain("C14-added-comment")
  })
})

describe("prose candidates from real session violations", () => {
  test("coined compounds get flagged", () => {
    expect(scanText("This makes the call spike-proofed.").map((f: { rule: string }) => f.rule)).toContain("P-proofed")
  })

  test("arrows in prose get flagged", () => {
    expect(scanText("Frame -> Deliver -> Act").map((f: { rule: string }) => f.rule)).toContain("P-arrows")
  })

  test("system jargon gets flagged", () => {
    const rules = scanText("The evidence ledger feeds the repair round.").map((f: { rule: string }) => f.rule)
    expect(rules).toContain("P-ocx-jargon")
  })

  test("repeated paragraph openers get flagged", () => {
    const reply = "The first part.\n\nThe second part.\n\nThe third part."
    expect(scanText(reply).map((f: { rule: string }) => f.rule)).toContain("P-repeat-opener")
  })

  test("em dash density gets flagged on long text", () => {
    const filler = "word ".repeat(70)
    const reply = `${filler}— one — two — three — four.`
    expect(scanText(reply).map((f: { rule: string }) => f.rule)).toContain("P-emdash-density")
  })

  test("plain clean prose stays silent", () => {
    const reply = "Fixed the redirect. Typecheck and tests pass. The guard now reads one field earlier."
    const ids = ExitGate.evaluate({ ...base, reply }).map((finding) => finding.id)
    expect(ids).toEqual([])
    expect(scanText(reply).map((f: { rule: string }) => f.rule)).toEqual([])
  })
})

describe("artifact slop check E4", () => {
  test("runs the artifact scan over added html lines", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      added: new Map([
        [
          "/site/index.html",
          ['<img src="https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1920" alt="living room">'],
        ],
      ]),
    })
    const hits = findings.filter((finding) => finding.id === "E4-artifact-slop")
    expect(hits.length).toBe(1)
    expect(hits[0].message).toContain("HOTLINKED_IMAGES")
  })

  test("stays silent for local assets and ignores prose rules inside code", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      added: new Map([["/site/index.html", ['<img src="assets/hero.jpg" alt="hero">']]]),
    })
    expect(findings.filter((finding) => finding.id === "E4-artifact-slop")).toEqual([])
  })
})

describe("frontend structure checks", () => {
  const nav = '<a href="#hero" class="nav-link text-cream/80 hover:text-gold transition-colors">Home</a>'

  test("flags a god-object html file holding many sections", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      added: new Map([
        ["/site/index.html", ["<section id=\"hero\">x</section>", "<section id=\"a\">x</section>", "<section id=\"b\">x</section>", "<section id=\"c\">x</section>", "<section id=\"d\">x</section>"]],
      ]),
    })
    expect(findings.some((finding) => finding.id === "E5-god-object-html")).toBe(true)
  })

  test("flags copy-pasted markup blocks by repeated class strings", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      added: new Map([["/site/index.html", Array(4).fill(nav)]]),
    })
    const hit = findings.find((finding) => finding.id === "E6-duplicated-markup")
    expect(hit?.message).toContain("nav-link")
  })

  test("stays silent for a small shell page with distinct markup", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([
        ["/site/index.html", ['<section id="hero" class="hero">', '<section id="cta" class="cta">', '<footer class="site-footer">']],
      ]),
    })
    expect(findings.some((finding) => finding.id === "E5-god-object-html")).toBe(false)
    expect(findings.some((finding) => finding.id === "E6-duplicated-markup")).toBe(false)
  })
})

describe("developer-feedback slop checks", () => {
  test("flags silently swallowed promises (C15)", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([["/a/x.ts", ['fetch(url).catch(() => {})']]]),
    })
    expect(findings.some((finding) => finding.id === "C15-swallowed-promise")).toBe(true)
  })

  test("allows handled failures (C15 negative)", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([["/a/x.ts", ["fetch(url).catch((error) => log.warn(error))"]]]),
    })
    expect(findings.some((finding) => finding.id === "C15-swallowed-promise")).toBe(false)
  })

  test("flags hardcoded credential literals (C16)", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([["/a/x.ts", ['const api_key = "sk-live-9d8f7g6h5j4k"']]]),
    })
    expect(findings.some((finding) => finding.id === "C16-hardcoded-secret")).toBe(true)
  })

  test("allows environment reads and short placeholders (C16 negatives)", () => {
    const findings = ExitGate.evaluate({
      ...base,
      added: new Map([
        ["/a/x.ts", ['const apiKey = process.env.API_KEY', 'const label = "password"', 'const token = ""']],
      ]),
    })
    expect(findings.some((finding) => finding.id === "C16-hardcoded-secret")).toBe(false)
  })
})

describe("whole-file blocker rescan (E7)", () => {
  test("surfaces blockers living anywhere in a changed file, not just added lines", () => {
    const findings = ExitGate.wholeFileBlockers(
      ["/site/index.html"],
      (path) => (path.endsWith(".html") ? '<img src="https://source.unsplash.com/800x600/?interior">' : undefined),
      { domainChecks: true },
    )
    const hit = findings.find((f) => f.id === "E7-wholefile-blocker")
    expect(hit?.message).toContain("HOTLINKED_IMAGES")
  })

  test("ignores files without violations and non-markup paths", () => {
    expect(ExitGate.wholeFileBlockers(["/site/index.html"], () => '<img src="assets/hero.jpg">')).toEqual([])
    expect(ExitGate.wholeFileBlockers(["/a/x.ts"], () => 'fetch(url).catch(() => {})')).toEqual([])
  })
})

describe("cross-file duplication and missing assets", () => {
  const shared = "const config = { theme: 'dark', layout: 'grid', animations: true, locale: 'en-US', fallback: 'auto' }"

  test("flags identical meaningful lines added to two files (E8)", () => {
    const findings = ExitGate.crossFileDuplication(
      new Map([
        ["/a/Header.js", [shared]],
        ["/b/Footer.js", [shared]],
      ]),
    )
    expect(findings.some((f) => f.id === "E8-cross-file-duplication")).toBe(true)
  })

  test("ignores imports, comments, and short lines", () => {
    const findings = ExitGate.crossFileDuplication(
      new Map([
        ["/a/x.ts", ["import { useEffect } from \"react\""]],
        ["/b/y.ts", ["import { useEffect } from \"react\""]],
      ]),
    )
    expect(findings).toEqual([])
  })

  test("flags referenced local assets that do not exist (E9)", () => {
    const findings = ExitGate.missingLocalAssets(
      new Map([["/site/index.html", ['<img src="assets/images/hero.jpg" alt="hero">']]]),
      (p) => undefined,
    )
    expect(findings.some((f) => f.id === "E9-missing-local-asset")).toBe(true)
    expect(findings[0].message).toContain("assets/images/hero.jpg")
  })

  test("passes when the asset exists locally", () => {
    const findings = ExitGate.missingLocalAssets(
      new Map([["/site/index.html", ['<img src="assets/images/hero.jpg" alt="hero">']]]),
      (p) => "<binary>",
    )
    expect(findings).toEqual([])
  })
})

describe("media localization invariant (E10)", () => {
  test("blocks remote images when the diff wrote zero asset files", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      added: new Map([
        ["/site/index.html", ['<img src="https://images.unsplash.com/photo-x?w=800" alt="room">']],
        ["/site/css/site.css", ["body { margin: 0 }"]],
      ]),
    })
    expect(findings.some((f) => f.id === "E10-media-not-localized")).toBe(true)
  })

  test("passes once real asset files are part of the change", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      added: new Map([
        ["/site/index.html", ['<img src="assets/images/hero.jpg" alt="room">']],
        ["/site/assets/images/hero.jpg", ["<binary>"]],
      ]),
    })
    expect(findings.some((f) => f.id === "E10-media-not-localized")).toBe(false)
  })
})

describe("unsupported quality claims (E11)", () => {
  test("flags generic praise when code changed", () => {
    const findings = ExitGate.evaluate({
      ...base,
      reply: "The site is production-ready and looks good.",
    })
    expect(findings.some((f) => f.id === "E11-unsupported-quality-claim")).toBe(true)
  })

  test("allows specific evidence-backed summaries", () => {
    const findings = ExitGate.evaluate({
      ...base,
      reply: "Contrast measured 6.2:1 on body text; images downloaded to assets/ and verified loading.",
    })
    expect(findings.some((f) => f.id === "E11-unsupported-quality-claim")).toBe(false)
  })
})

describe("plan conformance (E12)", () => {
  test("flags when zero planned files were written despite writes existing", () => {
    const findings = ExitGate.planConformance(
      ["site/nav.html", "site/footer.html", "site/content.html"],
      ["/work/site/index.html", "/work/site/css/site.css"],
    )
    expect(findings.some((f) => f.id === "E12-plan-not-followed")).toBe(true)
  })

  test("stays silent when the plan was followed or revised via suffix match", () => {
    expect(ExitGate.planConformance(["nav.html"], ["/w/site/sections/nav.html"]).some((f) => f.id === "E12-plan-not-followed")).toBe(false)
    expect(ExitGate.planConformance([], ["/a/x.ts"])).toEqual([])
  })
})

describe("loop-audit fixes", () => {
  test("E10 catches CSS url() remote images, not just attributes (E10)", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      added: new Map([["/site/css/site.css", ['body { background-image: url(https://cdn.example.net/pic.jpg); }']]]),
    })
    expect(findings.some((f) => f.id === "E10-media-not-localized")).toBe(true)
  })

  test("scanArtifact surfaces blockers ahead of warnings", async () => {
    const { OCXGate } = await import("../../src/ocx/slop-gate")
    const html = [
      '<img src="https://source.unsplash.com/800x600/?interior">',
      ...Array.from({ length: 14 }, () => '<a href="#">link</a>'),
    ].join("\n")
    const findings = OCXGate.scanArtifact(html)
    expect(findings[0]?.severity).toBe("blocker")
  })
})

describe("commented-out code gate (E13)", () => {
  test("flags changed files still carrying commented-out code", () => {
    const findings = ExitGate.commentedFiles(["/a/x.ts"], () => [
      "// oxlint-disable-next-line no-self-assign",
      "const a = b",
      "// const dead = true",
      "/* return false */",
      "export { a }",
    ].join("\n"))
    expect(findings.some((f) => f.id === "E13-comments-remain")).toBe(true)
    expect(findings[0].message).toContain("const dead")
  })

  test("stays silent for pragma-only or clean files", () => {
    const clean = ExitGate.commentedFiles(["/a/x.ts"], () => "// oxlint-disable-next-line no-self-assign\nconst a = 1")
    expect(clean).toEqual([])
    expect(ExitGate.commentedFiles([], () => "")).toEqual([])
  })
})

describe("interpreter file-mutation guard", () => {
  test("blocks heredoc and open-w writes from interpreters", async () => {
    const { fileMutationViaInterpreter } = await import("../../src/tool/shell")
    expect(fileMutationViaInterpreter("python3 << 'PYEOF'\nopen('/a/x.py','w').write('x')\nPYEOF")).toBeTruthy()
    expect(fileMutationViaInterpreter("node -e 'require(\"fs\").writeFileSync(\"/a/x.js\", \"x\")' > /dev/null")).toBeUndefined()
  })

  test("allows plain python execution without file writes", async () => {
    const { fileMutationViaInterpreter } = await import("../../src/tool/shell")
    expect(fileMutationViaInterpreter("python3 -c \"print(1+1)\"")).toBeUndefined()
  })
})
