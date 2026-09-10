import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { join } from "node:path"
import { OCXDb } from "../../src/ocx/ocx-db"
import { Evidence } from "../../src/ocx/evidence"
import { tmpdir } from "../fixture/fixture"

const verification: Evidence.Verification = {
  id: "verification_test",
  sessionID: "session_test",
  repositoryID: "/repo",
  check: "test",
  command: "bun test --api_key=secret-value",
  cwd: "/repo",
  outcome: "passed",
  durationMs: 12,
  ownerIDs: ["owner_test"],
  taskID: "task_test",
  createdAt: 1,
}

const link: Evidence.LinkRecord = {
  id: "link_test",
  source: "test",
  sourceRef: "bun test",
  target: verification.id,
  relation: "verifiedBy",
  createdAt: 1,
}

describe("OCX evidence", () => {
  test("parses bounded verification and provenance records", () => {
    expect(Evidence.parseVerification(verification)).toEqual(verification)
    expect(Evidence.parseLink(link)).toEqual(link)
    expect(Evidence.parseVerification({ ...verification, command: "=== injected ===" })).toBeUndefined()
    expect(Evidence.parseLink({ ...link, relation: "unknown" })).toBeUndefined()
  })

  test("keeps verification records after reopening SQLite and redacts commands", async () => {
    await using temp = await tmpdir()
    const filename = join(temp.path, "nested", "workflow.db")
    const first = await Effect.runPromise(OCXDb.open(filename))
    const stored = first.recordVerification(verification)
    first.recordLink(link)

    expect(stored.command).toBe("bun test --[REDACTED CREDENTIAL]")
    expect(first.verifications("session_test")).toEqual([stored])
    expect(first.links(verification.id)).toEqual([link])

    const second = await Effect.runPromise(OCXDb.open(filename))
    expect(second.verifications("session_test")).toEqual([stored])
    expect(second.links(verification.id)).toEqual([link])
  })
})
