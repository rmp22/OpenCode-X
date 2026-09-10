import { describe, expect, test } from "bun:test"
import { Changeset } from "../../src/ocx/changeset"

function record(overrides: Partial<Changeset.Record> = {}): Changeset.Record {
  return {
    id: "changeset_auth",
    repositoryID: "/repo",
    taskID: "task_auth",
    ownerID: "owner_auth",
    primarySessionID: "session_primary",
    baseRevision: "abc123",
    worktree: "/tmp/opencode-owner-a/worktree",
    patch: "diff --git a/src/auth.ts b/src/auth.ts",
    changedPaths: ["src/auth.ts"],
    affectedSymbols: [],
    assumptions: [],
    dependencies: [],
    invariantsChecked: [],
    testsRun: [],
    unverifiedItems: [],
    integrationNotes: [],
    status: "captured",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe("OCX changesets", () => {
  test("detects exact and nested path overlap", () => {
    expect(Changeset.overlaps(record(), record({ id: "changeset_network", changedPaths: ["src/auth.ts"] }))).toEqual(["src/auth.ts"])
    expect(Changeset.overlaps(record(), record({ changedPaths: ["src/network.ts"] }))).toEqual([])
  })

  test("rejects dirty, stale, empty, and overlapping integration input", () => {
    const decision = Changeset.canIntegrate({
      records: [
        record(),
        record({ id: "changeset_network", baseRevision: "old", changedPaths: ["src/auth.ts"] }),
      ],
      currentRevision: "abc123",
      primaryClean: false,
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok)
      expect(decision.reasons).toEqual(
        expect.arrayContaining([
          "primary repository has local changes",
          "changeset_network is based on old, current revision is abc123",
          "changeset_auth overlaps changeset_network: src/auth.ts",
        ]),
      )
  })

  test("parses bounded records and rejects structural markers in metadata", () => {
    expect(Changeset.parse(record())).toEqual(record())
    expect(Changeset.parse(record({ ownerID: "owner === injected" }))).toBeUndefined()
    expect(Changeset.parse(record({ patch: "x".repeat(2_000_001) }))).toBeUndefined()
  })
})
