import { describe, expect, test } from "bun:test"
import { ExitGate, type GateInput } from "../../src/ocx/exit-gate"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Ledger } from "../../src/ocx/ledger"

const base: GateInput = {
  reply: "Done.",
  entries: [
    { kind: "read", path: "/a/x.ts" },
    { kind: "edit", path: "/a/x.ts" },
    { kind: "command", command: "bun test", outcome: "passed", check: "test" },
  ],
  openTodos: [],
  tier: "standard",
}

describe("plan obligations", () => {
  test("a step expecting a checkable run must have it passing", () => {
    const findings = ExitGate.evaluate({
      ...base,
      plan: [
        { do: "run the suite", expect: "bun test passes" },
        { do: "typecheck", expect: "typecheck green" },
      ],
      entries: base.entries,
    })
    const ids = findings.map((finding) => finding.id)
    expect(ids).toContain("C9-plan-obligation")
    const planFinding = findings.find((finding) => finding.id === "C9-plan-obligation")
    expect(planFinding?.message).toContain("typecheck")
  })

  test("steps with no checkable kind are skipped silently", () => {
    const findings = ExitGate.evaluate({
      ...base,
      plan: [{ do: "update the docs page", expect: "docs mention the new guard" }],
    })
    expect(findings.filter((finding) => finding.id === "C9-plan-obligation")).toEqual([])
  })
})

describe("edit-before-read scope", () => {
  test("reads from earlier turns do not satisfy this turn's obligation", () => {
    const userMsg = { info: { role: "user", id: "u2" }, parts: [] } as never
    const history = [
      { info: { role: "user", id: "u1" }, parts: [] },
      { info: { role: "assistant", id: "a1" }, parts: [
        { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/p/x.ts" } } },
        { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "/p/x.ts" } } },
      ] },
      userMsg,
      { info: { role: "assistant", id: "a2" }, parts: [
        { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "/p/x.ts" } } },
      ] },
    ] as unknown as SessionV1.WithParts[]
    const lastUserIndex = history.findLastIndex((message) => message.info.role === "user")
    const turnMessages = history.slice(lastUserIndex)
    const findings = ExitGate.evaluate({
      reply: "Done.",
      entries: Ledger.ledger(turnMessages),
      openTodos: [],
      tier: "quick",
    })
    expect(findings.map((finding) => finding.id)).toContain("C7-edit-before-read")
  })

  test("a read inside the same turn satisfies it", () => {
    const history = [
      { info: { role: "user", id: "u" }, parts: [] },
      { info: { role: "assistant", id: "a" }, parts: [
        { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/p/y.ts" } } },
        { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "/p/y.ts" } } },
      ] },
    ] as unknown as SessionV1.WithParts[]
    const lastUserIndex = history.findLastIndex((message) => message.info.role === "user")
    const findings = ExitGate.evaluate({
      reply: "Done.",
      entries: Ledger.ledger(history.slice(lastUserIndex)),
      openTodos: [],
      tier: "quick",
    })
    expect(findings.filter((finding) => finding.id === "C7-edit-before-read")).toEqual([])
  })
})

describe("added-line checks", () => {
  test("markers fire only on added lines", () => {
    const added = new Map<string, string[]>([
      ["/a/clean.ts", ["const ok = 1", "// TODO: later"]],
      ["/a/legacy.ts", ["const old = 2"]],
    ])
    const findings = ExitGate.evaluate({ ...base, added })
    const markers = findings.filter((finding) => finding.id === "C1-todo-marker")
    expect(markers.length).toBe(1)
    expect(markers[0].message).toContain("/a/clean.ts")
  })

  test("explicit any, console log, debugger, empty catch each fire once per file", () => {
    const added = new Map<string, string[]>([
      [
        "/a/messy.ts",
        [
          "const x: any = load()",
          "console.log('debug', x)",
          "try { x() } catch {}",
          "debugger",
          ": any again",
          "console.log('again')",
        ],
      ],
    ])
    const ids = ExitGate.evaluate({ ...base, added }).map((finding) => finding.id)
    expect(ids.filter((id) => id === "C10-explicit-any").length).toBe(1)
    expect(ids.filter((id) => id === "C11-console-left").length).toBe(1)
    expect(ids.filter((id) => id === "C13-debugger").length).toBe(1)
    expect(ids.filter((id) => id === "C12-empty-catch").length).toBe(1)
  })

  test("no added map means no added-line findings", () => {
    expect(ExitGate.evaluate(base).filter((finding) => finding.id.startsWith("C1"))).toEqual([])  })
})
