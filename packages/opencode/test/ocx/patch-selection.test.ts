import { describe, expect, test } from "bun:test"
import { lstatSync, readFileSync } from "node:fs"
import { mkdir, symlink } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import type { LLM } from "../../src/session/llm"
import { PatchSelection } from "../../src/ocx/patch-selection"
import { tmpdir } from "../fixture/fixture"

const model = {} as Provider.Model
const user = {} as SessionV1.User

describe("patch selection", () => {
  test("parses at most two complete candidates", () => {
    const raw = JSON.stringify({
      candidates: [
        { label: "one", files: [{ path: "change.ts", content: "one" }] },
        { label: "two", files: [{ path: "change.ts", content: "two" }] },
        { label: "three", files: [{ path: "change.ts", content: "three" }] },
      ],
    })
    expect(PatchSelection.parseCandidates(raw).map((item) => item.label)).toEqual(["one", "two"])
    expect(PatchSelection.parseCandidates("not json")).toEqual([])
  })

  test("selects an improved candidate in isolation and leaves the workspace unchanged", async () => {
    await using dependency = await tmpdir({
      init: async (directory) => Bun.write(join(directory, "fixture.txt"), "dependency\n"),
    })
    await using tmp = await tmpdir({
      init: async (directory) => {
        await Bun.write(join(directory, "package.json"), JSON.stringify({ scripts: { test: "test" } }))
        await Bun.write(join(directory, "change.ts"), "fail\n")
        await Bun.write(join(directory, "change.test.ts"), "test\n")
        await mkdir(join(directory, "node_modules"))
        await symlink(join(dependency.path, "fixture.txt"), join(directory, "node_modules", "fixture.txt"))
      },
    })
    const responses = [
      JSON.stringify({ candidates: [{ label: "red", files: [{ path: "change.ts", content: "fail\n" }] }] }),
      JSON.stringify({ candidates: [{ label: "green", files: [{ path: "change.ts", content: "pass\n" }] }] }),
    ]
    let calls = 0
    const llm: LLM.Interface = {
      stream: () => Stream.make(LLMEvent.textDelta({ id: `candidate-${calls}`, text: responses[calls++] ?? "{}" })),
    }
    const selected = await Effect.runPromise(
      PatchSelection.selectCandidate(
        { llm },
        {
          cwd: tmp.path,
          changedPaths: ["change.ts"],
          currentFiles: [{ path: "change.ts", content: "fail\n" }],
          findings: [{ id: "C4-tests-not-green", message: "test failed" }],
          baselineFailed: 1,
          user,
          model,
          sessionID: "ses_patch_selection",
          exec: ({ cwd }) => {
            expect(lstatSync(join(cwd, "node_modules")).isSymbolicLink()).toBe(false)
            expect(lstatSync(join(cwd, "node_modules", "fixture.txt")).isSymbolicLink()).toBe(false)
            expect(readFileSync(join(cwd, "node_modules", "fixture.txt"), "utf8")).toBe("dependency\n")
            return {
              outcome: readFileSync(join(cwd, "change.ts"), "utf8").includes("pass") ? "passed" : "failed",
              durationMs: 1,
            }
          },
        },
      ),
    )

    expect(selected?.candidate.label).toBe("green")
    expect(calls).toBe(2)
    expect(readFileSync(join(tmp.path, "change.ts"), "utf8")).toBe("fail\n")
  })

  test("rejects a candidate outside the changed files", async () => {
    await using tmp = await tmpdir({ init: async (directory) => Bun.write(join(directory, "change.ts"), "old\n") })
    expect(() =>
      PatchSelection.applyCandidate(
        tmp.path,
        { label: "unsafe", files: [{ path: "../outside.ts", content: "bad" }] },
        ["change.ts"],
      ),
    ).toThrow("existing changed file")
  })

  test("rejects a changed file that resolves through a symlink", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir({ init: async (directory) => Bun.write(join(directory, "change.ts"), "outside\n") })
    await symlink(join(outside.path, "change.ts"), join(tmp.path, "change.ts"))

    expect(() =>
      PatchSelection.applyCandidate(
        tmp.path,
        { label: "unsafe", files: [{ path: "change.ts", content: "bad" }] },
        ["change.ts"],
      ),
    ).toThrow("existing changed file")
  })
})
