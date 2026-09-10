import { describe, expect, test } from "bun:test"
import { ExitGate } from "../../src/ocx/exit-gate"
import type { LedgerEntry } from "../../src/ocx/ledger"
import { PlanWorkstreamState } from "../../src/ocx/plan-workstream-state"

const entries: LedgerEntry[] = [
  { kind: "read", path: "/a/auth.ts" },
  { kind: "edit", path: "/a/auth.ts" },
  { kind: "command", command: "bun test", outcome: "passed", check: "test" },
]

const base = { entries, openTodos: [] as string[], tier: "standard" as const }

describe("exit gate english checks", () => {
  test("flags banned words and long sentences in the reply", () => {
    const reply =
      "Let me delve into this. We should utilize the existing helper furthermore, and then we will be able to see that the refactor keeps every behavior intact while it also improves the structure across all of the modules that were touched today."
    const findings = ExitGate.evaluate({ ...base, reply })
    expect(findings.map((finding) => finding.id)).toContain("E1-banned-word")
    expect(findings.map((finding) => finding.id)).toContain("E2-long-sentence")
  })

  test("passes a clean short reply", () => {
    const findings = ExitGate.evaluate({ ...base, reply: "Refactor done. Typecheck and tests are green." })
    expect(findings.filter((finding) => finding.id.startsWith("E"))).toEqual([])
  })

  test("exempts quoted lines and fenced code from word checks", () => {
    const reply = "> the docs say to delve deeper\n\n```\nconst mode = 'seamless'\n```"
    const findings = ExitGate.evaluate({ ...base, reply })
    expect(findings.filter((finding) => finding.id === "E1-banned-word")).toEqual([])
  })

  test("does not flag ordinary uses of cheer words mid-sentence", () => {
    const findings = ExitGate.evaluate({ ...base, reply: "This approach looks good. Moving on." })
    expect(findings.filter((finding) => finding.id === "E1-banned-word")).toEqual([])
  })

  test("treats newlines as sentence boundaries", () => {
    const reply = "Short line one.\n- bullet point\n- another bullet\nShort close."
    const findings = ExitGate.evaluate({ ...base, reply })
    expect(findings.filter((finding) => finding.id === "E2-long-sentence")).toEqual([])
  })

  test("prior clean read clears stale-read flag; absent prior keeps it", () => {
    const entries = [{ kind: "edit", path: "/a/x.ts" }] as const
    const stale = ExitGate.evaluate({
      reply: "Done.",
      entries: [...entries],
      openTodos: [],
      tier: "quick",
      priorReadPaths: ["/a/x.ts"],
    })
    expect(stale.filter((finding) => finding.id === "C7-edit-before-read")).toEqual([])

    const cold = ExitGate.evaluate({
      reply: "Done.",
      entries: [...entries],
      openTodos: [],
      tier: "quick",
    })
    expect(cold.map((finding) => finding.id)).toContain("C7-edit-before-read")
  })

  test("creating a file needs no prior read; editing without reading is flagged", () => {
    const createdOnly = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "write", path: "/new/file.ts" }],
      openTodos: [],
      tier: "quick",
    })
    expect(createdOnly.filter((finding) => finding.id === "C7-edit-before-read")).toEqual([])

    const editedCold = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "write", path: "/new/file.ts" }, { kind: "edit", path: "/other/existing.ts" }],
      openTodos: [],
      tier: "quick",
    })
    expect(editedCold.map((finding) => finding.id)).toContain("C7-edit-before-read")
  })

  test("copyright headers in javadoc/kdoc format are exempt from comment flags", () => {
    const header = [
      "/*",
      " * Copyright (c) 2026 Acme. All rights reserved.",
      " * Licensed under the Apache License.",
      " */",
      "export const x = 1;",
    ].join("\n")
    expect(ExitGate.commentedFiles(["/src/License.kt"], () => header)).toEqual([])
  })

  test("renders a directive block only when findings exist", () => {
    expect(ExitGate.directive([])).toBeUndefined()
    const rendered = ExitGate.directive([{ id: "E1-banned-word", message: "banned", span: "delve" }])
    expect(rendered).toContain("=== OCX EXIT GATE ===")
    expect(rendered).toContain("delve")
    expect(rendered).toContain("=== END OCX EXIT GATE ===")
  })
})

describe("design fidelity", () => {
  test("passes when a decision keyword surfaces in changed ui files", () => {
    const added = new Map([["index.html", ['<div class="hero-grid">intro</div>']]])
    expect(
      ExitGate.designFidelity({ direction: "dark editorial", distinctiveDecisions: ["asymmetric hero grid"] }, added),
    ).toEqual([])
  })

  test("flags a recorded decision with no trace in the changed markup", () => {
    const added = new Map([["index.html", ["<p>plain</p>"]]])
    const findings = ExitGate.designFidelity({ direction: "warm", distinctiveDecisions: ["navy serif identity"] }, added)
    expect(findings.map((finding) => finding.id)).toContain("D1-design-decision-absent")
    expect(findings[0].span).toBe("navy serif identity")
  })

  test("skips when no ui files changed or no design was recorded", () => {
    const codeOnly = new Map([["src/x.ts", ["const x = 1"]]])
    expect(ExitGate.designFidelity({ direction: "d", distinctiveDecisions: ["asymmetric hero grid"] }, codeOnly)).toEqual([])
    expect(ExitGate.designFidelity(undefined, new Map([["a.html", ["<p>x</p>"]]]))).toEqual([])
  })

  test("evaluate enforces the design record end to end", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      reply: "Done.",
      design: { direction: "editorial", distinctiveDecisions: ["navy serif identity"] },
      added: new Map([["page.css", [".card { color: #ffffff; }"]]]),
    })
    expect(findings.map((finding) => finding.id)).toContain("D1-design-decision-absent")
  })

  test("flags absolute-certainty claims when code changed", () => {
    const findings = ExitGate.evaluate({ ...base, reply: "The migration is guaranteed safe." })
    expect(findings.map((finding) => finding.id)).toContain("E11-unsupported-quality-claim")

    const impossible = ExitGate.evaluate({ ...base, reply: "This design is impossible to fail." })
    expect(impossible.map((finding) => finding.id)).toContain("E11-unsupported-quality-claim")
  })

  test("flags literature citations on a tool-free turn and passes grounded turns", () => {
    const closedBook = ExitGate.evaluate({
      reply: "As arxiv.org/abs/2509.04664 shows, evals reward guessing.",
      entries: [{ kind: "edit", path: "/a/x.ts" }],
      openTodos: [],
      tier: "quick",
    })
    expect(closedBook.map((finding) => finding.id)).toContain("F1-unverified-reference")

    const grounded = ExitGate.evaluate({
      reply: "As arxiv.org/abs/2509.04664 shows, evals reward guessing.",
      entries: [
        { kind: "read", path: "https://arxiv.org/abs/2509.04664" },
        { kind: "edit", path: "/a/x.ts" },
      ],
      openTodos: [],
      tier: "quick",
    })
    expect(grounded.filter((finding) => finding.id === "F1-unverified-reference")).toEqual([])
  })

  test("does not accept an unrelated read as citation evidence", () => {
    const findings = ExitGate.evaluate({
      reply: "As https://example.com/paper shows, the claim holds.",
      entries: [{ kind: "read", path: "/a/notes.md" }],
      openTodos: [],
      tier: "quick",
    })
    expect(findings.map((finding) => finding.id)).toContain("F1-unverified-reference")
  })

  test("flags fix claims without a passing run and passes them once tests are recorded", () => {
    const unproven = ExitGate.evaluate({
      reply: "This fixes the race condition.",
      entries: [{ kind: "edit", path: "/a/x.ts" }],
      openTodos: [],
      tier: "standard",
    })
    expect(unproven.map((finding) => finding.id)).toContain("C18-unverified-fix-claim")

    const proven = ExitGate.evaluate({
      reply: "This fixes the race condition.",
      entries: [
        { kind: "edit", path: "/a/x.ts" },
        { kind: "command", command: "bun test", outcome: "passed", check: "test" },
      ],
      openTodos: [],
      tier: "standard",
    })
    expect(proven.filter((finding) => finding.id === "C18-unverified-fix-claim")).toEqual([])
  })

  test("surfaces markup-baseline findings through evaluate", () => {
    const findings = ExitGate.evaluate({
      ...base,
      domainChecks: true,
      reply: "Done.",
      added: new Map([["index.html", ['<html><img src="/assets/hero.jpg"></html>']]]),
    })
    const ids = findings.map((finding) => finding.id)
    expect(ids).toContain("F7-img-missing-alt")
    expect(ids).toContain("F10-html-no-lang")
  })

  test("flags printed arithmetic slips through evaluate", () => {
    const findings = ExitGate.evaluate({
      ...base,
      reply: "Sharding gives 17 * 23 = 381 total slots.",
    })
    expect(findings.map((finding) => finding.id)).toContain("R1-arithmetic-slip")
  })

  test("pipeline guards: code-in-chat and length-cap detection", () => {
    const dump = [
      "Delivering the seven source files verbatim. Save them at these exact relative paths.",
      "```html",
      "<!doctype html>",
      "<html>",
      "</html>",
      "```",
      "```js",
      "const a = 1;",
      "const b = 2;",
      "```",
    ].join("\n")
    const readOnly = ExitGate.codeInChatFinding(dump, [{ kind: "read", path: "/a" }])
    expect(readOnly?.id).toBe("C22-code-in-chat")

    expect(ExitGate.codeInChatFinding(dump, [{ kind: "write", path: "/src/a.html" }])).toBeUndefined()
    expect(
      ExitGate.codeInChatFinding("Here is one small snippet:\n```js\nconst a = 1;\n```", [{ kind: "read", path: "/a" }]),
    ).toBeUndefined()
    expect(
      ExitGate.codeInChatFinding(dump.replace("Save them at these exact relative paths.", "Example usage below."), [
        { kind: "read", path: "/a" },
      ]),
    ).toBeUndefined()

    expect(ExitGate.hitLengthCap([{ type: "step-finish", reason: "length" }])).toBe(true)
    expect(ExitGate.hitLengthCap([{ type: "step-finish", reason: "stop" }])).toBe(false)
    expect(
      ExitGate.hitLengthCap([
        { type: "step-finish", reason: "length" },
        { type: "tool-call" },
        { type: "step-finish", reason: "tool-calls" },
      ]),
    ).toBe(false)
    expect(ExitGate.hitLengthCap([])).toBe(false)
  })

  test("surfaces output-style findings through evaluate", () => {
    const findings = ExitGate.evaluate({
      ...base,
      reply: "Done. Hope this helps! Let me know if you would like me to adjust anything.",
    })
    expect(findings.map((finding) => finding.id)).toContain("S-engagement-bait")
  })

  test("flags a relative-import cycle between two changed files", () => {
    const findings = ExitGate.evaluate({
      reply: "Done.",
      entries: [
        { kind: "read", path: "/src/a.ts" },
        { kind: "edit", path: "/src/a.ts" },
        { kind: "edit", path: "/src/b.ts" },
      ],
      openTodos: [],
      tier: "quick",
      added: new Map([
        ["/src/a.ts", ['import { b } from "./b"', "export const a = 1;"]],
        ["/src/b.ts", ['import { a } from "./a"', "export const b = a + 1;"]],
      ]),
    })
    const cycle = findings.find((finding) => finding.id === "C20-import-cycle")
    expect(cycle).toBeDefined()
    expect(cycle?.span).toContain("/src/a.ts")
    expect(cycle?.span).toContain("/src/b.ts")
  })

  test("stays silent for acyclic chains, unresolved imports, and self-imports", () => {
    const acyclic = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "edit", path: "/src/a.ts" }],
      openTodos: [],
      tier: "quick",
      added: new Map([
        ["/src/a.ts", ['import { b } from "./b"', "export const a = b + 1;"]],
        ["/src/b.ts", ["export const b = 1;"]],
      ]),
    })
    expect(acyclic.filter((finding) => finding.id === "C20-import-cycle")).toEqual([])

    const unresolved = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "edit", path: "/src/a.ts" }],
      openTodos: [],
      tier: "quick",
      added: new Map([["/src/a.ts", ['import { x } from "./missing"']]]),
    })
    expect(unresolved.filter((finding) => finding.id === "C20-import-cycle")).toEqual([])

    const selfRef = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "edit", path: "/src/a.ts" }],
      openTodos: [],
      tier: "quick",
      added: new Map([["/src/a.ts", ['import { me } from "./a"']]]),
    })
    expect(selfRef.filter((finding) => finding.id === "C20-import-cycle")).toEqual([])
  })
})

describe("exit gate evidence checks", () => {
  test("requires the final output header when strict output checks are enabled", () => {
    const findings = ExitGate.evaluate({ ...base, reply: "Done.", strictOutput: true })
    expect(findings.map((finding) => finding.id)).toContain("O1-output-header")

    const clean = ExitGate.evaluate({
      ...base,
      reply: "PHASE: verify DEPTH: standard STATE: done\nVerified: tests pass.",
      strictOutput: true,
    })
    expect(clean.filter((finding) => finding.id === "O1-output-header")).toEqual([])
  })

  test("flags unknown check language in strict plan checks", () => {
    const findings = ExitGate.evaluate({
      ...base,
      reply: "PHASE: verify DEPTH: standard STATE: done",
      strictOutput: true,
      strictPlanChecks: true,
      plan: [{ do: "Run the benchmark", expect: "benchmark is clean" }],
    })
    expect(findings.map((finding) => finding.id)).toContain("C29-plan-check-unknown")
  })

  test("blocks unapproved scope reduction on broad close requests", () => {
    const findings = ExitGate.evaluate({
      ...base,
      reply: "PHASE: verify DEPTH: standard STATE: done\nOnly the local patch landed; browser work remains.",
      strictOutput: true,
      userPrompt: "Finish every requested change.",
    })
    expect(findings.map((finding) => finding.id)).toContain("C30-scope-reduced")
    expect(ExitGate.blocksClose(findings.find((finding) => finding.id === "C30-scope-reduced")!)).toBe(true)

    const accepted = ExitGate.evaluate({
      ...base,
      reply: "PHASE: verify DEPTH: standard STATE: done\nOnly the local patch landed.",
      strictOutput: true,
      userPrompt: "Finish only the local change.",
    })
    expect(accepted.filter((finding) => finding.id === "C30-scope-reduced")).toEqual([])
  })

  test("requires a passing test run when code changed on standard tier", () => {
    const noTests = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "edit", path: "/a/x.ts" }],
      openTodos: [],
      tier: "standard",
    })
    expect(noTests.map((finding) => finding.id)).toContain("C4-tests-not-green")

    const quick = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "edit", path: "/a/x.ts" }],
      openTodos: [],
      tier: "quick",
    })
    expect(quick.filter((finding) => finding.id === "C4-tests-not-green")).toEqual([])
  })

  test("requires trusted evidence for execution-plan checks", () => {
    const plan = PlanWorkstreamState.parseExecutionPlan([
      "goal=Build the page",
      "workstream=page",
      "  target=index.html",
      "  step=Write the page",
      "    target=index.html",
      "    check=Page renders",
    ].join("\n")).plan
    const findings = ExitGate.evaluate({ ...base, reply: "PHASE: verify DEPTH: standard STATE: done", executionPlan: plan })
    expect(findings.map((finding) => finding.id)).toContain("C34-execution-plan-check")
  })

  test("catches a pass claim without a recorded run", () => {
    const findings = ExitGate.evaluate({
      reply: "All tests pass.",
      entries: [{ kind: "edit", path: "/a/x.ts" }],
      openTodos: [],
      tier: "quick",
    })
    expect(findings.map((finding) => finding.id)).toContain("C5-claim-without-run")
  })

  test("reports open todos at claim time", () => {
    const findings = ExitGate.evaluate({ ...base, reply: "Done.", openTodos: ["ship the fix"] })
    expect(findings.map((finding) => finding.id)).toContain("C6-open-todos")
  })

  test("blocks reviewer blockers and full-tier rerun findings", () => {
    expect(ExitGate.blocksClose({ id: "R1-review-finding", message: "defect" })).toBe(true)
    expect(ExitGate.blocksClose({ id: "C32-rerun-greenwashing", message: "rerun" })).toBe(true)
    expect(ExitGate.blocksClose({ id: "R1-review-advisory", message: "advice" })).toBe(false)
  })

  test("requires reading a path before changing it", () => {
    const findings = ExitGate.evaluate({
      reply: "Done.",
      entries: [{ kind: "edit", path: "/a/never-read.ts" }],
      openTodos: [],
      tier: "quick",
    })
    expect(findings.map((finding) => finding.id)).toContain("C7-edit-before-read")
  })

  test("failed typecheck blocks even when tests passed", () => {
    const mixed: LedgerEntry[] = [
      { kind: "read", path: "/a/x.ts" },
      { kind: "edit", path: "/a/x.ts" },
      { kind: "command", command: "bun test", outcome: "passed", check: "test" },
      { kind: "command", command: "bun run typecheck", outcome: "failed", check: "typecheck" },
    ]
    const findings = ExitGate.evaluate({ reply: "Done.", entries: mixed, openTodos: [], tier: "standard" })
    expect(findings.map((finding) => finding.id)).toContain("C3-typecheck-failed")
  })
})

describe("comment checks", () => {
  test("flags comments in Kotlin files and allows a license header and pragma", () => {
    const kotlin = [
      "/* Copyright 2026 Example */",
      "package sample",
      "@Suppress(\"unused\")",
      "// val removed = true",
      "val value = 1",
    ].join("\n")
    const findings = ExitGate.commentedFiles(["/a/Sample.kt"], () => kotlin)
    expect(findings.map((finding) => finding.id)).toEqual(["E13-comments-remain"])
    expect(findings[0]?.span).toContain("val removed")
  })

  test("does not flag a license header or compiler pragma alone", () => {
    const source = [
      "/* Copyright 2026 Example */",
      "package sample",
      "@file:Suppress(\"unused\")",
      "val value = 1",
    ].join("\n")
    expect(ExitGate.commentedFiles(["/a/Sample.kt"], () => source)).toEqual([])
  })

  test("does not treat a CSS color as a shell comment", () => {
    expect(ExitGate.commentedFiles(["/a/theme.css"], () => ".card { color: #fff; }")).toEqual([])
  })

  test("flags a hash comment added to a Python file", () => {
    const findings = ExitGate.evaluate({
      ...base,
      reply: "Done.",
      added: new Map([["/a/tool.py", ["value = 1 # return 2"]]]),
    })
    expect(findings.map((finding) => finding.id)).toContain("C14-added-comment")
  })
})
