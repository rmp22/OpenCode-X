import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { Strategy } from "../../src/ocx/strategy"
import { SystemPrompt } from "../../src/session/system"
import { MCP } from "../../src/mcp"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  LayerNode.compile(SystemPrompt.node, [
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        instructions: () =>
          Effect.succeed([
            {
              name: "guide-server",
              instructions: "Use lookup before mutate.",
              tools: [],
            },
            {
              name: "tool-server",
              instructions: "Prefer search before update.",
              tools: ["tool-server_search", "tool-server_update"],
            },
          ]),
      }),
    ],
    [
      Skill.node,
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          require: (name) => {
            const info = skills.find((skill) => skill.name === name)
            if (info) return Effect.succeed(info)
            return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((skill) => skill.name) }))
          },
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ],
  ]),
)

describe("session.system", () => {
  test("uses the OpenCode-X prompt", () => {
    const prompt = SystemPrompt.provider()[0]
    expect(prompt).toContain("OpenCode-X")
    expect(prompt).toContain("Cite file claims as `file_path:line_number`. Never invent line numbers.")
    expect(prompt).toContain("Prefix work claims with `VERIFIED:` or `UNVERIFIED:`.")
    expect(prompt).toContain("Treat generated output as unchecked until reviewed.")
    expect(prompt).toContain("A successful tool call, build, or write operation does not prove correctness.")
    expect(prompt).toContain("Check state: `pass|fail|unknown|not-applicable`.")
    expect(prompt).not.toContain("Claims use [V] source, [I] inferred, or [A] assumed.")
    expect(prompt).toContain("`find`, `verify`, `subagents`, `train`, and `knowledge` are tools only when listed.")
    expect(prompt).toContain("The last user message defines the job. User requirements are binding.")
    expect(prompt).toContain("Read repo instructions before writing. Load code-generation rules before the first code change.")
    expect(prompt).not.toContain("No `!!`")
  })

  test("formats the selected model variant for benchmark paths", () => {
    const prompt = SystemPrompt.modelIdentity({
      model: {
        api: { id: "chatgpt-5.6-luna", url: "https://example.test", npm: "test" },
        providerID: ProviderV2.ID.make("openai"),
        variants: { xhigh: { reasoningEffort: "xhigh" } },
      },
      variant: "xhigh",
    })

    expect(prompt).toContain("Selected model variant: xhigh")
    expect(prompt).toContain("Reasoning effort: xhigh")
    expect(prompt).toContain("Benchmark model slug: chatgpt-5.6-luna-xhigh")
    expect(prompt).toContain("replace only that placeholder with the benchmark model slug above")
  })

  test("loads the OCX prompt injections", () => {
    const prompts = SystemPrompt.provider({ mode: "primary", hidden: false }).join("\n")
    expect(prompts).toContain("OCX THINKING")
    expect(prompts).not.toContain("OCX STRATEGY CATALOG")
    expect(prompts).not.toContain("UI DESIGN CORE")
    expect(prompts).not.toContain("OCX GLOSSARY INDEX")
    expect(prompts).not.toContain("OCX WORKFLOW REMINDER")
    expect(prompts).toContain("Short facts only. No self-talk. No repeat context.")
    expect(prompts).toContain("Thinking in simple English. Short sentence. Common word. One idea per line.")
    expect(prompts).toContain("Symbols: `->` next, `?` branch, `=>` result, `!` blocker, `&` parallel, alternative.")
    expect(prompts).toContain("Doubt become check. I state change, caller, untested area.")
    expect(prompts).toContain("=== STRATEGY GATE ===")
    expect(prompts).toContain("Every mutation creates a verification obligation.")
    expect(prompts).not.toContain("Load all needed strategy documents with one batched strategy call")
    expect(prompts).not.toContain("Before the first mutation, call the `strategy` tool once")
    expect(prompts).toContain("Research that never reaches the artifact is a partial result")
    expect(prompts).toContain("=== REQUIREMENTS BAR ===")
    expect(prompts).toContain("Require a user-defined change agreement")
    expect(prompts).toContain("Do not infer preserve mode, YOLO mode")
    expect(prompts).toContain("For greenfield work, choose sensible defaults and proceed")
    expect(prompts).toContain("plan and implement in the same turn")
    expect(prompts).toContain("operation, goal, scope, allowed change dimensions")
    expect(prompts).toContain("=== CONSECUTIVE REQUESTS ===")
    expect(prompts).toContain("Keep earlier unfinished requests in the todo list")
    expect(prompts).toContain("Before switching active work, record a compact checkpoint")
    expect(prompts).toContain("Latest user message = active focus")
    expect(prompts).toContain("New request arrive: I classify")
    expect(prompts).toContain("Intent unclear = ask one question. No guess.")
    expect(prompts).not.toContain("=== UI HARD GATES ===")
    expect(prompts).not.toContain("- stack: language and platform conventions")
    expect(prompts).not.toContain("- write: code writing rules")
    expect(prompts).not.toContain("- memory: repository map rules")
    expect(prompts).not.toContain("- fonts: typography research, typeface selection, and script or RTL/LTR coverage")
    expect(Strategy.load("fonts")).toContain("Never use Arial")
    expect(Strategy.load("fonts")).toContain("Google Fonts Knowledge")
    expect(Strategy.load("ui")).toContain("RTL AND LTR")
    expect(Strategy.load("ui")).toContain("Script fake out")
    expect(Strategy.load("web-design")).toContain("`scrollLeft` can start at 0 and go negative")
  })

  test("pipeline prompts do not advertise the hidden bulk strategy tool", () => {
    const prompts = SystemPrompt.provider({ mode: "primary", hidden: false, pipeline: true }).join("\n")
    expect(prompts).not.toContain("OCX STRATEGY CATALOG")
    expect(prompts).not.toContain("one batched strategy call")
    expect(prompts).toContain("The runtime owns phase changes")
  })

  test("keeps UI, codegen, and review blockers", () => {
    expect(Strategy.load("ui")).toContain("Treat user requirements as hard requirements.")
    expect(Strategy.load("ui")).toContain("If one source fails, do not stop")
    expect(Strategy.load("ui")).toContain(
      "Treat a clear goal and output destination as enough to start",
    )
    expect(Strategy.load("ui")).toContain("UI DESIGN CORE")
    expect(Strategy.load("ui")).toContain("=== UI HARD GATES ===")
    expect(Strategy.load("ui")).toContain("use the built-in `websearch` tool to find an official source")
    expect(Strategy.load("ui")).toContain("record two or three distinct design directions")
    expect(Strategy.load("ui")).toContain("Record the typography table and a main visual or proof")
    expect(Strategy.load("ui")).toContain("a text-only page is incomplete")
    expect(Strategy.load("ui")).toContain("source-to-artifact link")
    expect(Strategy.load("ui")).toContain("A screenshot command or `overflow-x: hidden` is not proof")
    expect(Strategy.load("ui")).toContain("Load the `audit` strategy once after all page code")
    expect(Strategy.load("ui")).toContain("Render in a browser at mobile and desktop sizes")
    expect(Strategy.load("ui")).toContain("AI-LIKE OUTPUT BLOCKERS")
    expect(Strategy.load("ui")).toContain("Keep root HTML as a shell")
    expect(Strategy.load("ui")).toContain("brand sources")
    expect(Strategy.load("ui")).toContain("Create these files before writing section code")
    expect(Strategy.load("ui")).toContain("Prefer three to five content sections")
    expect(Strategy.load("ui")).toContain("Do not use mono for ordinary navigation")
    expect(Strategy.load("ui")).toContain("Reject persistent rails, decorative maps")
    expect(Strategy.load("ui")).toContain("Do not end a page with a giant slogan")
    expect(Strategy.load("ui")).toContain("Before page code, write a short checklist")
    expect(Strategy.load("ui")).toContain("For a page with three or more sections")
    expect(Strategy.load("ui")).toContain("In a plain frontend, put each section")
    expect(Strategy.load("ui")).toContain("Split styles into shared values")
    expect(Strategy.load("ui")).toContain("Android UI: use Material 3 Expressive")
    expect(Strategy.load("ui")).toContain("Use Google Sans Flex")
    expect(Strategy.load("ui")).toContain("use color, shape, size, motion, and grouping")
    expect(Strategy.load("ui")).toContain("Web, iOS, and other UI")
    expect(Strategy.load("ui")).toContain("Check letter height, width, openings")
    expect(Strategy.load("ui")).toContain("official brand rules and approved product images")
    expect(Strategy.load("ui")).toContain("Separate the official wordmark or brand script")
    expect(Strategy.load("ui")).toContain("For a branded hero, do not use DM Sans")
    expect(Strategy.load("ui")).toContain("familiar narrow heading font")
    expect(Strategy.load("ui")).toContain("visible display-versus-reading distinction")
    expect(Strategy.load("ui")).toContain("popular geometric-sans and neutral-sans pairing")
    expect(Strategy.load("ui")).toContain("Derive the palette from approved product images")
    expect(Strategy.load("ui")).toContain("Define display, heading, body, label, and caption roles")
    expect(Strategy.load("ui")).toContain("Use advanced font settings")
    expect(Strategy.load("ui")).toContain("Record a typography table with role")
    expect(Strategy.load("ui")).toContain("VISUAL PRINCIPLES")
    expect(Strategy.load("ui")).toContain("Give each viewport one main focus")
    expect(Strategy.load("ui")).toContain("Do not fake forms, links, CTAs, saved states, or success")
    expect(Strategy.load("ui")).toContain("Choose fonts for the brand and content")
    expect(Strategy.load("ui")).toContain("Do not use `vw` alone for text")
    expect(Strategy.load("ui")).toContain("Do not depict a named product")
    expect(Strategy.load("ui")).toContain("Give carousels labelled previous and next controls")
    expect(Strategy.load("ui")).toContain("Do not add fake live or online chips")
    expect(Strategy.load("ui")).toContain("Use product-specific language and evidence")
    expect(Strategy.load("ui")).toContain("Remove repeated all-caps mono eyebrows")
    expect(Strategy.load("ui")).toContain("If the user supplies references")
    expect(Strategy.load("ui")).toContain("Use references as evidence, not things to copy")
    expect(Strategy.load("ui")).toContain("DESIGN PATTERN AND TASTE")
    expect(Strategy.load("ui")).toContain("Choose one primary pattern family")
    expect(Strategy.load("ui")).toContain("Describe each direction as a design plan")
    expect(Strategy.load("ui")).toContain("Vary section pacing deliberately")
    expect(Strategy.load("ui")).toContain("Reject the default sequence of centered hero")
    expect(Strategy.load("ui")).toContain("Build a page flow")
    expect(Strategy.load("ui")).toContain("Set shared values for color")
    expect(Strategy.load("ui")).toContain("Product identity guide the design")
    expect(Strategy.load("ui")).toContain("main design idea and three product-specific decisions")
    expect(Strategy.load("ui")).toContain("distinct motion tied to the product or story")
    expect(Strategy.load("ui")).toContain("section table")
    expect(Strategy.load("ui")).toContain("propose two or three structurally different directions")
    expect(Strategy.load("ui")).toContain("Give every section a main visual or proof")
    expect(Strategy.load("ui")).toContain("Do not imitate a known competitor")
    expect(Strategy.load("ui")).toContain("Do not start branded page code until an official source")
    expect(Strategy.load("ui")).toContain("If an earlier output exists, list three concrete")
    expect(Strategy.load("ui")).toContain("inspect them and record three specific failures")
    expect(Strategy.load("ui")).toContain("For beverage and consumer-brand pages, reject the combined formula")
    expect(Strategy.load("ui")).toContain("Do not use CSS shapes as a named product")
    expect(Strategy.load("ui")).toContain("Record the source page, URL, owner or license")
    expect(Strategy.load("ui")).toContain("Product media must have a composition reason")
    expect(Strategy.load("ui")).toContain("Do not invent slogans, taglines, sensory claims")
    expect(Strategy.load("ui")).toContain("Keep content in normal flow")
    expect(Strategy.load("ui")).toContain("Hero: one promise, one main action")
    expect(Strategy.load("ui")).toContain("Controls: use native controls")
    expect(Strategy.load("ui")).toContain("Compare the logo or wordmark and hero heading")
    expect(Strategy.load("ui")).toContain("Do not treat anti-slop as a black/red/cream editorial template")
    expect(Strategy.load("ui")).toContain("Run a joint pattern audit before delivery")
    expect(Strategy.load("ui")).toContain("Run a lookalike test on the page structure")
    expect(Strategy.load("ui")).toContain("Treat source heuristics and model review as hints")
    expect(Strategy.load("write")).toContain(
      "B4 write: read every applicable `AGENTS.md` + repo instruction file.",
    )
    expect(Strategy.load("write")).toContain("Verify imported package/API/config key/repo convention vs source or doc")
    expect(Strategy.load("write")).toContain("For larger changes, plan file ownership")
    expect(Strategy.load("write")).toContain("Define the file and module tree before the first change")
    expect(Strategy.load("write")).toContain("Fit new code to its callers")
    expect(Strategy.load("write")).toContain("Treat structure as part of correctness")
    expect(Strategy.load("write")).toContain("Write a `FILE PLAN` with `path`, `owns`")
    expect(Strategy.load("write")).toContain("If no clean boundary can be proven")
    expect(Strategy.load("ui")).toContain("=== WEB STRUCTURE RULES ===")
    expect(Strategy.load("ui")).toContain("Plain HTML has no automatic partial loading")
    expect(Strategy.load("ui")).toContain("Preserve behavior while splitting")
    expect(Strategy.load("ui")).toContain("Progressive enhancement is required")
    expect(Strategy.load("ui")).toContain("Keep repeated metrics, labels, chart points")
    expect(Strategy.load("ui")).toContain("An interaction is valid only when it changes")
    expect(Strategy.load("ui")).toContain("Reject empty-root JavaScript rendering")
    expect(Strategy.load("ui")).toContain("Capture `pageerror`, console errors, failed requests")
    expect(Strategy.load("write")).toContain(
      "A broad refactor or rewrite is valid only when the requirements bar allows it",
    )
    expect(Strategy.load("engineering")).toContain("Do not narrow an accepted broad rewrite into a cosmetic patch")
    expect(Strategy.load("engineering")).toContain("unless the requirements bar explicitly allows behavior changes")
    expect(Strategy.load("web-design")).toContain("Do not stop after one failed URL")
    expect(Strategy.load("ui")).toContain("require a user-defined requirements bar before editing")
    expect(Strategy.load("ui")).toContain(
      "For a clear greenfield request, choose structure, behavior, content, visual design, dependencies, and assets yourself",
    )
    expect(Strategy.load("ui")).toContain("A familiar result is a failure when the agreement required a new structure")
    expect(Strategy.load("frontier")).toContain("Build one inventory pass, then reuse it")
    expect(Strategy.load("frontier")).toContain("Set a research budget before searching")
    expect(Strategy.load("frontier")).toContain("Do not call `websearch` or `webfetch` merely to satisfy a checklist")
    expect(Strategy.load("frontier")).toContain("visual or frontend work targets 30")
    expect(Strategy.load("frontier")).toContain("Use `todowrite` at task start")
    expect(Strategy.load("frontier")).toContain("Classify failures before retrying")
    expect(Strategy.load("frontier")).toContain("Optimize cost per successful task")
    expect(Strategy.load("frontier")).toContain("Group related mutations after the source pass")
    expect(Strategy.load("frontier")).toContain("Load the `audit` strategy after page code is present")
    expect(Strategy.load("review")).toContain("When the task builds a screen, apply the loaded `ui` strategy")
    expect(Strategy.load("review")).toContain("The file and module tree was defined before the first change")
    expect(Strategy.load("review")).toContain("Entry files coordinate")
    expect(Strategy.load("review")).toContain("the final file tree matches the recorded `FILE PLAN`")
    expect(Strategy.load("review")).toContain("No hallucinated imports")
    expect(Strategy.load("review")).toContain("Generated imports, APIs, dependencies, claims")
    expect(Strategy.load("review")).toContain("Tests have an explicit behavior oracle")
    expect(Strategy.load("review")).toContain("Reviewers can explain each changed boundary")
    expect(Strategy.load("web")).toContain("Use the built-in `websearch` tool")
    expect(Strategy.load("web")).toContain("Do not depend on shell scripts or local binaries")
    expect(Strategy.load("engineering")).toContain("Keep changes within the accepted requirements bar")
    expect(Strategy.load("engineering")).toContain("Keep entry files thin")
    expect(Strategy.load("engineering")).toContain("Keep module links clear")
    expect(Strategy.load("engineering")).toContain("Keep prototypes separate from production code")
    expect(Strategy.load("complexity")).toContain("Do not hide complexity with workarounds")
    expect(Strategy.load("complexity")).toContain("Do not add layers, factories, wrappers")
    expect(Strategy.load("stack")).not.toContain("Android UI:")
    expect(Strategy.load("android")).toContain("Use Material 3 Expressive and Google Sans Flex by default")
  })

  test("loads phase rules for visible agents", () => {
    const prompts = [
      ...SystemPrompt.provider({ mode: "primary", hidden: false }),
      ...SystemPrompt.provider({ mode: "all", hidden: false }),
      ...SystemPrompt.provider({ mode: "subagent", hidden: false }),
    ].join("\n")
    expect(prompts.match(/=== DESIGN ===/g)).toHaveLength(3)
    expect(prompts.match(/=== VERIFY ===/g)).toHaveLength(3)
  })

  test("omits OCX prompts for hidden and small requests", () => {
    expect(SystemPrompt.provider({ mode: "primary", hidden: true })).toEqual([])
    expect(SystemPrompt.provider({ mode: "primary", hidden: false, small: true })).toEqual([])
  })

  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
      expect(output).not.toContain("manual-skill")
    }),
  )

  it.effect("MCP output includes connected server instructions", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build)

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          '  <server name="tool-server">',
          "    Prefer search before update.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )

  it.effect("MCP output omits servers when all advertised tools are denied", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build, Permission.fromConfig({ "tool-server_*": "deny" }))

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )
})
