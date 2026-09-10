import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Ledger } from "../../src/ocx/ledger"

const toolPart = (tool: string, state: Record<string, unknown>) =>
  ({
    type: "tool",
    tool,
    state,
  }) as unknown as SessionV1.Part

const assistant = (...parts: unknown[]) =>
  ({ info: { role: "assistant", id: "m" }, parts }) as unknown as SessionV1.WithParts

const bash = (command: string, status = "completed", exit?: number) =>
  toolPart("bash", { status, input: { command }, ...(exit !== undefined ? { metadata: { exit } } : {}) })

const source = (tool: string, input: Record<string, unknown>, output = "", status = "completed") =>
  toolPart(tool, { status, input, output })

const edit = (filePath: string) => toolPart("edit", { status: "completed", input: { filePath } })

const applyPatch = (...files: { filePath: string; movePath?: string }[]) =>
  toolPart("apply_patch", {
    status: "completed",
    input: { patchText: "*** Begin Patch\n*** Update File: change.ts\n*** End Patch" },
    metadata: { files },
  })

const read = (path: string) => toolPart("read", { status: "completed", input: { filePath: path } })

describe("evidence ledger", () => {
  test("extracts ordered reads, writes, and command outcomes", () => {
    const entries = Ledger.ledger([
      assistant(read("/a/auth.ts"), edit("/a/auth.ts"), bash("bun test", "error")),
    ])
    expect(entries).toEqual([
      { kind: "read", path: "/a/auth.ts" },
      { kind: "edit", path: "/a/auth.ts" },
      { kind: "command", command: "bun test", outcome: "failed", check: "test" },
    ])
  })

  test("classifies known check commands by prefix, ignoring chained extras", () => {
    const entries = Ledger.ledger([assistant(bash("bun run typecheck && echo ok"))])
    expect(entries[0]).toMatchObject({ kind: "command", check: "typecheck" })
  })

  test("classifies Bazel build and test evidence", () => {
    const entries = Ledger.ledger([
      assistant(bash("bazel build //...", "completed", 0)),
      assistant(bash("bazel test //...", "completed", 0)),
    ])
    expect(entries).toEqual([
      { kind: "command", command: "bazel build //...", outcome: "passed", check: "build" },
      { kind: "command", command: "bazel test //...", outcome: "passed", check: "test" },
    ])
  })

  test("prefix match works on the plain command form", () => {
    const entries = Ledger.ledger([
      assistant(bash("bun run typecheck", "completed", 0)),
      assistant(bash("pytest -q tests/", "completed", 0)),
    ])
    expect(Ledger.lastOutcome(entries, "typecheck")).toBe("passed")
    expect(Ledger.lastOutcome(entries, "test")).toBe("passed")
    expect(Ledger.lastOutcome(entries, "build")).toBe("none")
  })

  test("changedPaths lists write and edit targets in first-touch order", () => {
    const entries = Ledger.ledger([
      assistant(read("/b/x.ts"), edit("/b/x.ts"), read("/a"), assistant([]) as never),
      assistant(
        toolPart("write", { status: "completed", input: { filePath: "/c/new.ts" } }),
        edit("/b/x.ts"),
      ),
    ])
    expect(Ledger.changedPaths(entries)).toEqual(["/b/x.ts", "/c/new.ts"])
  })

  test("changedPaths lists apply_patch result files and move targets", () => {
    const entries = Ledger.ledger([
      assistant(applyPatch({ filePath: "/a/old.ts", movePath: "/a/new.ts" }, { filePath: "/b/add.ts" })),
    ])

    expect(entries).toEqual([
      { kind: "edit", path: "/a/old.ts" },
      { kind: "edit", path: "/a/new.ts" },
      { kind: "edit", path: "/b/add.ts" },
    ])
    expect(Ledger.changedPaths(entries)).toEqual(["/a/old.ts", "/a/new.ts", "/b/add.ts"])
  })

  test("ignores pending and running commands for outcomes", () => {
    const entries = Ledger.ledger([assistant(bash("bun test", "running")), assistant(bash("bun test", "unknown"))])
    expect(Ledger.lastOutcome(entries, "test")).toBe("none")
  })

  test("does not treat a completed command without an exit code as passing", () => {
    const entries = Ledger.ledger([assistant(bash("bun test"))])
    expect(entries[0]).toMatchObject({ outcome: "unknown", check: "test" })
    expect(Ledger.lastOutcome(entries, "test")).toBe("none")
  })

  test("uses a shell exit code to classify a completed nonzero command as failed", () => {
    const entries = Ledger.ledger([
      assistant(toolPart("bash", { status: "completed", input: { command: "bun test" }, metadata: { exit: 1 } })),
    ])
    expect(entries[0]).toMatchObject({ outcome: "failed", check: "test" })
  })

  test("records completed web source URLs and DOI evidence", () => {
    const entries = Ledger.ledger([
      assistant(
        source("webfetch", { url: "https://example.com/paper" }, "DOI 10.1000/example.1"),
        source("youtube-transcript", { url: "https://youtu.be/video" }),
        source("websearch", { query: "paper" }, "[Paper](https://example.com/result) javascript:bad"),
      ),
    ])
    expect(Ledger.sourcePaths(entries)).toEqual([
      "https://example.com/paper",
      "doi:10.1000/example.1",
      "https://youtu.be/video",
      "https://example.com/result",
    ])
  })

  test("does not treat failed web tools as opened sources", () => {
    const entries = Ledger.ledger([
      assistant(source("webfetch", { url: "https://example.com/fail" }, "content", "error")),
    ])
    expect(Ledger.sourcePaths(entries)).toEqual([])
  })

  test("flags an identical failed command followed by a pass without file mutation", () => {
    const findings = Ledger.rerunFindings([
      { kind: "command", command: "bun test  --filter=unit", outcome: "failed", check: "test" },
      { kind: "read", path: "/a/test.ts" },
      { kind: "command", command: " bun   test --filter=unit ", outcome: "passed", check: "test" },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.id).toBe("C32-rerun-greenwashing")
  })

  test("does not flag a pass after a file mutation or a different command", () => {
    expect(
      Ledger.rerunFindings([
        { kind: "command", command: "bun test", outcome: "failed", check: "test" },
        { kind: "edit", path: "/a/fix.ts" },
        { kind: "command", command: "bun test", outcome: "passed", check: "test" },
      ]),
    ).toEqual([])
    expect(
      Ledger.rerunFindings([
        { kind: "command", command: "bun test", outcome: "failed", check: "test" },
        { kind: "command", command: "bun run typecheck", outcome: "passed", check: "typecheck" },
        { kind: "command", command: "bun test", outcome: "passed", check: "test" },
      ]),
    ).toEqual([])
  })
})
