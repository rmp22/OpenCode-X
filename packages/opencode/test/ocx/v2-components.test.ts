import { describe, expect, test } from "bun:test"
import { Rails } from "../../src/ocx/rails"
import { Calibration } from "../../src/ocx/calibration"
import { PlaybookTool } from "../../src/ocx/playbook-tool"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("edit rails", () => {
  test("clean TypeScript passes silently", () => {
    expect(Rails.syntaxRail("/x/a.ts", "const value = 1\n")).toBeUndefined()
  })

  test("syntax error is reported with the path", () => {
    const rail = Rails.syntaxRail("/x/broken.ts", "const = = 2\n")
    expect(rail).toContain("[ocx rail] syntax error in /x/broken.ts")
  })

  test("non-JS families have no v0 rail", () => {
    expect(Rails.syntaxRail("/x/main.py", "def x(:\n")).toBeUndefined()
  })
})

describe("playbook tool", () => {
  const instance = PlaybookTool.createPlaybookTool() as unknown as {
    execute: (args: { name: string }) => Promise<{ output: string; metadata: { valid: boolean } }>
  }

  test("returns the full playbook text for a known name", async () => {
    const result = await instance.execute({ name: "ui" })
    expect(result.metadata.valid).toBe(true)
    expect(result.output).toContain("UI DESIGN CORE")
  })

  test("lists available names for an unknown one", async () => {
    const result = await instance.execute({ name: "nope" })
    expect(result.metadata.valid).toBe(false)
    expect(result.output).toContain("typescript")
  })
})

describe("calibration store", () => {
  test("appends one jsonl line per record", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocx-cal-"))
    try {
      Calibration.append(dir, {
        time: 1,
        sessionID: "s1",
        tier: "standard",
        findings: [{ id: "E1-banned-word", span: "delve" }],
      })
      Calibration.append(dir, { time: 2, sessionID: "s1", tier: "quick", round: 2, findings: [] })
      const lines = readFileSync(join(dir, "ocx", "findings.jsonl"), "utf8").trim().split("\n")
      expect(lines.length).toBe(2)
      expect(JSON.parse(lines[0]).findings[0].id).toBe("E1-banned-word")
      expect(JSON.parse(lines[1]).round).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
