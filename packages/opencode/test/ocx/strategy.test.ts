import { describe, expect, test } from "bun:test"
import { Strategy } from "../../src/ocx/strategy"

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
    expect(ui).toContain("reversed Latin text")
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

describe("stack selection", () => {
  test("maps each language stack to its own adapter", () => {
    expect(Strategy.stackStrategies("typescript")).toEqual(["typescript"])
    expect(Strategy.stackStrategies("python")).toEqual(["python"])
    expect(Strategy.stackStrategies("rust")).toEqual(["rust"])
    expect(Strategy.stackStrategies("go")).toEqual(["go"])
    expect(Strategy.stackStrategies("java")).toEqual(["java"])
    expect(Strategy.stackStrategies("kotlin")).toEqual(["kotlin"])
    expect(Strategy.stackStrategies("cpp")).toEqual(["cpp"])
    expect(Strategy.stackStrategies("swift")).toEqual(["swift"])
  })

  test("pairs Android and Compose with the Kotlin adapter", () => {
    expect(Strategy.stackStrategies("android")).toEqual(["android", "kotlin"])
    expect(Strategy.stackStrategies("compose")).toEqual(["compose", "kotlin"])
  })

  test("ignores unknown and missing stacks", () => {
    expect(Strategy.stackStrategies("ruby")).toEqual([])
    expect(Strategy.stackStrategies(null)).toEqual([])
    expect(Strategy.stackStrategies(undefined)).toEqual([])
  })

  test("keeps the generic stack free of language rules", () => {
    // The per-language rules live in their adapters so a session only gets its
    // own stack. This fails if someone reintroduces the all-language blob.
    const stack = Strategy.load("stack")
    expect(stack).not.toContain("Kotlin:")
    expect(stack).not.toContain("Java:")
    expect(stack).not.toContain("C++:")
    expect(stack).not.toContain("TypeScript:")
    expect(stack).not.toContain("Android UI:")
    expect(stack).not.toContain("Compose:")
    expect(Strategy.load("android")).toContain("Material 3 Expressive")
    expect(Strategy.load("kotlin")).toContain("FQNs")
    expect(Strategy.load("java")).toContain("@Override")
    expect(Strategy.load("cpp")).toContain("#pragma once")
    expect(Strategy.load("typescript")).toContain("wildcard imports")
  })
})

describe("debug reasoning", () => {
  const reasoning = Strategy.load("reasoning")

  test("carries the observation-first and cause-chain strategies", () => {
    // Agans: quit thinking and look, check the plug. Zeller/SRE: cause chains,
    // contributing factors, intermittent conditions.
    expect(reasoning).toContain("- S10 LOOK FIRST")
    expect(reasoning).toContain("- S11 CAUSE CHAIN")
    expect(reasoning).toContain("- S12 CHECK THE PLUG")
    expect(reasoning).toContain("One green run proves nothing")
    expect(reasoning).toContain("Record each tried change")
    expect(reasoning).toContain("STRATEGY: <S1..S12>")
  })

  test("names the reasoning failure modes it guards against", () => {
    expect(reasoning).toContain("S11 CAUSE CHAIN")
    expect(reasoning).toContain("forcing one root cause onto a multi-cause failure")
    expect(reasoning).toContain("symptom patches")
  })
})

describe("ai slop bans", () => {
  test("quality carries the prose-tell bans", () => {
    const quality = Strategy.load("quality")
    expect(quality).toContain("Ban overused model phrases: delve")
    expect(quality).toContain("Ban sycophancy openers")
    expect(quality).toContain("Limit em dashes")
    expect(quality).toContain("Reviews lead with blocking findings")
  })

  test("write and review carry the code-slop gates", () => {
    expect(Strategy.load("write")).toContain("Reuse an existing dependency or helper before adding one")
    expect(Strategy.load("write")).toContain("Compute once per path")
    const review = Strategy.load("review")
    expect(review).toContain("A sort test that checks length but never order is a failed test")
    expect(review).toContain("Tests written in the same pass as the code share its assumptions")
    expect(review).toContain("Review output leads with blocking findings")
  })

  test("ui carries the second-wave visual tells and fonts carries the new reflexes", () => {
    // signs-of-ai-design field guide: defaults migrate, so the ban list tracks
    // the escapes too (cream after purple, Geist/Instrument Serif after Inter).
    const ui = Strategy.load("ui")
    expect(ui).toContain("emerald fallback")
    expect(ui).toContain("Ban gradient text on headings")
    expect(ui).toContain("untouched framework components")
    expect(ui).toContain("Sparkles for AI, Zap for fast")
    expect(ui).toContain('Built with v0" or Lovable badges')
    expect(ui).toContain("Ban uniform motion")
    expect(Strategy.load("fonts")).toContain("Geist (the v0 default), Instrument Serif")
    expect(Strategy.load("fonts")).toContain("oversized italic serif hero is the newest reflex")
  })

  test("no loaded ocx text contains a banned tell", () => {
    // Self-application: the corpus that bans tells must not carry them.
    // Lines that declare a ban are exempt; they must name the offender.
    const banned = ["TODO:", "FIXME:", "Certainly,", "Great question", " delve ", "tapestry", "\ud83d\ude80"]
    for (const name of Strategy.STRATEGY_NAMES) {
      const text = (Strategy.load(name) ?? "")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("- Ban "))
        .join("\n")
      for (const tell of banned) {
        expect({ strategy: name, tell, found: text.includes(tell) }).toEqual({
          strategy: name,
          tell,
          found: false,
        })
      }
    }
  })
})

describe("workflow strategies", () => {
  test("pairs debugging sessions with the debug playbook regardless of the selector", () => {
    expect(Strategy.workflowStrategies("debugging")).toEqual(["reasoning"])
  })

  test("adds nothing for other, unknown, or missing workflows", () => {
    expect(Strategy.workflowStrategies("feature")).toEqual([])
    expect(Strategy.workflowStrategies("codegen")).toEqual([])
    expect(Strategy.workflowStrategies("not-a-workflow")).toEqual([])
    expect(Strategy.workflowStrategies(undefined)).toEqual([])
  })
})

describe("think strategy", () => {
  test("carries decomposition-first method and math hygiene", () => {
    // Human canon carries the thinking steps: Polya's restate-and-look-back
    // principles and the classical fallacy list. LLM papers back only the
    // model-specific rule: offload exact arithmetic to tools.
    const think = Strategy.load("think")
    expect(think).toContain("Restate the problem in your own words")
    expect(think).toContain("Solve them smallest first")
    expect(think).toContain("never in your head")
    expect(think).toContain("Estimate size first")
    expect(think).toContain("state one rival answer or explanation")
    expect(think).toContain("confirm it a second, independent way")
    expect(think).toContain("Label each claim fact, estimate, or guess")
  })

  test("sits in the catalog with a selector trigger", () => {
    expect(Strategy.STRATEGY_NAMES).toContain("think")
    expect(Strategy.catalog()).toContain(
      "- think: step-by-step thinking, math hygiene, and judgment guards. Load when: multi-step reasoning, math, planning, or hard judgment calls.",
    )
  })
})
