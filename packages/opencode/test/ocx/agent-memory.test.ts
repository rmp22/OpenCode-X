import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { join } from "node:path"
import { AgentMemory } from "../../src/ocx/agent-memory"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

const root = join(import.meta.dir, "../..")
const worker = join(import.meta.dir, "../fixture/agent-memory-worker.ts")

function memory(marker: string) {
  return {
    workdir: "/workspace",
    objective: marker,
    scope: marker,
    phase: marker,
    completed: [marker],
    evidence: [marker],
    corrections: [marker],
    nextAction: marker,
    nextCheck: marker,
  }
}

function runWorker(databasePath: string, sessionID: string, marker: string) {
  return Process.run([process.execPath, worker, databasePath, sessionID, marker], {
    cwd: root,
    nothrow: true,
  })
}

describe("OCX agent memory", () => {
  test("persists complete session memory across database opens", async () => {
    await using temp = await tmpdir()
    const databasePath = join(temp.path, "nested", "agent-memory.db")
    const first = await Effect.runPromise(AgentMemory.open(databasePath))
    const saved = memory("first state")

    first.set("ses_memory_roundtrip", saved)

    const second = await Effect.runPromise(AgentMemory.open(databasePath))
    expect(second.get("ses_memory_roundtrip")).toEqual(saved)
    second.clear("ses_memory_roundtrip")
    expect(second.get("ses_memory_roundtrip")).toBeUndefined()
  })

  test("ignores malformed stored lists instead of inventing checkpoint state", async () => {
    await using temp = await tmpdir()
    const databasePath = join(temp.path, "agent-memory.db")
    const store = await Effect.runPromise(AgentMemory.open(databasePath))
    store.set("ses_memory_corrupt", memory("valid state"))

    const { default: Database } = await import("bun:sqlite")
    const raw = new Database(databasePath)
    raw.exec("UPDATE agent_memory SET completed = '{broken'")
    raw.close()

    expect(store.get("ses_memory_corrupt")).toBeUndefined()
  })

  test("surfaces database open failures through the error channel", async () => {
    const exit = await Effect.runPromise(AgentMemory.open("/dev/null/blocked/agent-memory.db").pipe(Effect.exit))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("serializes concurrent process writes without partial records", async () => {
    await using temp = await tmpdir()
    const databasePath = join(temp.path, "agent-memory.db")
    const unique = Array.from({ length: 12 }, (_, index) => ({
      sessionID: `ses_memory_${index}`,
      marker: `unique-${index}`,
    }))
    const shared = Array.from({ length: 6 }, (_, index) => ({
      sessionID: "ses_memory_shared",
      marker: `shared-${index}`,
    }))
    const jobs = [...unique, ...shared]
    const results = await Promise.all(jobs.map((job) => runWorker(databasePath, job.sessionID, job.marker)))

    expect(results.map((result) => result.code)).toEqual(Array.from({ length: jobs.length }, () => 0))
    expect(results.map((result) => result.stderr.toString()).filter(Boolean)).toEqual([])

    const store = await Effect.runPromise(AgentMemory.open(databasePath))
    for (const job of unique) expect(store.get(job.sessionID)?.objective).toBe(job.marker)
    const sharedRecord = store.get("ses_memory_shared")
    expect(sharedRecord).toBeDefined()
    if (sharedRecord) {
      expect(sharedRecord.scope).toBe(sharedRecord.objective)
      expect(sharedRecord.phase).toBe(sharedRecord.objective)
      expect(sharedRecord.completed).toEqual([sharedRecord.objective])
      expect(sharedRecord.evidence).toEqual([sharedRecord.objective])
      expect(sharedRecord.corrections).toEqual([sharedRecord.objective])
      expect(sharedRecord.nextAction).toBe(sharedRecord.objective)
      expect(sharedRecord.nextCheck).toBe(sharedRecord.objective)
    }
  }, 20_000)
})
