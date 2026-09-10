import { describe, expect, test } from "bun:test"
import { EventJournal } from "@/ocx/events/journal"
import { reconstructState } from "@/ocx/events/recovery"
import { SuspensionManager } from "@/ocx/suspension"
import { join } from "node:path"
import { writeFileSync, rmSync, existsSync } from "node:fs"

describe("Hardened Events, Suspensions & Recovery", () => {
  test("idempotent event appending rejects duplicates with same idempotency key", () => {
    const journal = new EventJournal("sess_idemp")

    const ev1 = journal.append({
      id: "ev1",
      sessionID: "sess_idemp",
      type: "node_transition",
      payload: { to: "execute" },
      timestamp: Date.now(),
      idempotencyKey: "key_1001",
    })

    const evDup = journal.append({
      id: "ev1_dup",
      sessionID: "sess_idemp",
      type: "node_transition",
      payload: { to: "execute" },
      timestamp: Date.now(),
      idempotencyKey: "key_1001",
    })

    expect(ev1).toBeDefined()
    expect(evDup).toBeDefined()
    expect(evDup?.id).toBe("ev1")

    const all = journal.readAll()
    expect(all.length).toBe(1)
    expect(all[0].sequence).toBe(1)
  })

  test("assigns monotonic sequence numbers across session events", () => {
    const journal = new EventJournal("sess_seq")

    const ev1 = journal.append({
      id: "ev1",
      sessionID: "sess_seq",
      type: "step_start",
      payload: {},
      timestamp: Date.now(),
    })
    const ev2 = journal.append({
      id: "ev2",
      sessionID: "sess_seq",
      type: "step_complete",
      payload: {},
      timestamp: Date.now(),
    })

    expect(ev1?.sequence).toBe(1)
    expect(ev2?.sequence).toBe(2)
  })

  test("state reconstruction from event replay matches live state", () => {
    const journal = new EventJournal("sess_replay")

    journal.append({
      id: "ev1",
      sessionID: "sess_replay",
      type: "node_transition",
      payload: { to: "plan" },
      timestamp: Date.now(),
    })
    journal.append({
      id: "ev2",
      sessionID: "sess_replay",
      type: "node_transition",
      payload: { to: "execute" },
      timestamp: Date.now(),
    })
    journal.append({
      id: "ev3",
      sessionID: "sess_replay",
      type: "evidence_recorded",
      payload: { id: "ev_chk1", kind: "test_run", detail: "tests pass" },
      timestamp: Date.now(),
    })

    const events = journal.readAll()
    const state = reconstructState("sess_replay", events)

    expect(state.currentNode).toBe("execute")
    expect(state.visitedNodes).toEqual(["plan", "execute"])
    expect(state.accumulatedEvidence.length).toBe(1)
  })

  test("re-entry protection rejects duplicate resumption of active suspension", () => {
    const manager = new SuspensionManager()
    const record = manager.create({
      sessionID: "sess_susp",
      kind: "approval",
      reason: "Needs approval",
    })

    const firstResume = manager.resume("sess_susp", record.id, { approved: true })
    expect(firstResume.success).toBe(true)

    const secondResume = manager.resume("sess_susp", record.id, { approved: true })
    expect(secondResume.success).toBe(false)
    if (!secondResume.success) {
      expect(secondResume.reason).toContain("already resumed")
    }
  })

  test("cancels stale suspensions after expiration threshold", () => {
    const manager = new SuspensionManager()
    const record = manager.create({
      sessionID: "sess_stale",
      kind: "review",
      reason: "Waiting for code review",
    })

    const cancelledCount = manager.cancelStale("sess_stale", 0)
    expect(cancelledCount).toBe(1)

    const resumeRes = manager.resume("sess_stale", record.id, "Approved")
    expect(resumeRes.success).toBe(false)
    if (!resumeRes.success) {
      expect(resumeRes.reason).toContain("already cancelled")
    }
  })

  test("handles partial and corrupt journal lines gracefully without crashing", () => {
    const tmpDir = join("/tmp", `ocx_corrupt_${Date.now()}`)
    const journal = new EventJournal("sess_corrupt", tmpDir)

    journal.append({
      id: "valid_1",
      sessionID: "sess_corrupt",
      type: "start",
      payload: {},
      timestamp: Date.now(),
    })

    const logPath = join(tmpDir, "events_sess_corrupt.jsonl")
    writeFileSync(logPath, "{ corrupted json line\n", { flag: "a" })

    journal.append({
      id: "valid_2",
      sessionID: "sess_corrupt",
      type: "end",
      payload: {},
      timestamp: Date.now(),
    })

    const all = journal.readAll()
    expect(all.length).toBe(2)
    expect(all[0].id).toBe("valid_1")
    expect(all[1].id).toBe("valid_2")

    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
