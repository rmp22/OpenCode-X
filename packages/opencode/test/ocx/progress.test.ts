import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { join } from "node:path"
import { Header } from "../../src/ocx/header"
import { Progress } from "../../src/ocx/progress"
import { tmpdir } from "../fixture/fixture"

function checkpoint(sessionID: string, workdir: string) {
  return {
    sessionID,
    workdir,
    objective: "Improve Android work",
    scope: "Read the current implementation and make one focused change",
    phase: "change",
    completed: ["Read the target files"],
    evidence: ["Source paths and callers are recorded"],
    corrections: ["Continue the current work instead of restarting completed work"],
    nextAction: "Apply the smallest compatible change",
    nextCheck: "Run the focused test and typecheck",
  }
}

describe("OCX durable progress", () => {
  test("round-trips bounded state and renders generic resume instructions", async () => {
    await using temp = await tmpdir()
    const input = checkpoint("ses_progress_roundtrip", temp.path)

    const result = await Effect.runPromise(Progress.write(input, temp.path))
    expect(result.saved).toBe(true)
    expect(result.path).toBe(join(temp.path, "ocx", "agent-memory.db"))
    expect(await Bun.file(join(temp.path, "ocx", "progress", `${input.sessionID}.md`)).exists()).toBe(false)
    expect(await Effect.runPromise(Progress.read(input.sessionID, temp.path))).toContain(
      "NEXT ACTION: Apply the smallest compatible change",
    )
    expect(await Effect.runPromise(Progress.resumeDirective(input.sessionID, temp.path))).toContain(
      "Continue the current work",
    )
    expect(await Effect.runPromise(Progress.resumeDirective(input.sessionID, temp.path))).not.toContain(
      "restart research",
    )
  })

  test("rejects an oversized update without replacing the last valid checkpoint", async () => {
    await using temp = await tmpdir()
    const input = checkpoint("ses_progress_bounds", temp.path)

    expect((await Effect.runPromise(Progress.write(input, temp.path))).saved).toBe(true)
    const rejected = await Effect.runPromise(Progress.write({ ...input, nextAction: "x".repeat(281) }, temp.path))

    expect(rejected.saved).toBe(false)
    expect(await Effect.runPromise(Progress.read(input.sessionID, temp.path))).toContain(
      "NEXT ACTION: Apply the smallest compatible change",
    )
  })

  test("binds unsafe session IDs as database keys", async () => {
    await using temp = await tmpdir()
    const input = checkpoint("../../escape", temp.path)
    const result = await Effect.runPromise(Progress.write(input, temp.path))

    expect(result.saved).toBe(true)
    expect(result.path).toBe(join(temp.path, "ocx", "agent-memory.db"))
    expect(await Effect.runPromise(Progress.read(input.sessionID, temp.path))).toContain(
      "NEXT ACTION: Apply the smallest compatible change",
    )
  })

  test("seeds the next plan action into durable progress", async () => {
    await using temp = await tmpdir()
    const header = Header.parseHeader({
      topic: "Improve Android work",
      strategies: [],
      workflow: "coding",
      phase: "understand",
      risks: [],
      plan: [
        { do: "Read the Android source", expect: "Source paths are recorded" },
        { do: "Apply the focused change", expect: "The targeted test passes" },
      ],
      workstreams: [{ id: "android", goal: "Improve Android behavior" }],
    })

    const result = await Effect.runPromise(Progress.seed({ sessionID: "ses_progress_seed", workdir: temp.path, header }, temp.path))
    const saved = await Effect.runPromise(Progress.read("ses_progress_seed", temp.path))

    expect(result.saved).toBe(true)
    expect(saved).toContain("OBJECTIVE: Improve Android work")
    expect(saved).toContain("NEXT ACTION: Read the Android source")
  })

  test("provides detailed field errors with key and cap on over-length inputs (B1 fix)", async () => {
    const input = checkpoint("ses_b1", "/tmp")
    const longEvidence = "e".repeat(1500)
    const validWithLongEvidence = Progress.parseDetailed({
      ...input,
      evidence: [longEvidence],
    })
    expect(validWithLongEvidence.success).toBe(true)

    const overLengthEvidence = "e".repeat(2001)
    const invalidResult = Progress.parseDetailed({
      ...input,
      evidence: [overLengthEvidence],
    })
    expect(invalidResult.success).toBe(false)
    if (!invalidResult.success) {
      expect(invalidResult.errors.length).toBeGreaterThan(0)
      expect(invalidResult.errors[0]?.key).toBe("ev")
      expect(invalidResult.errors[0]?.cap).toBe(2000)
    }
  })
})
