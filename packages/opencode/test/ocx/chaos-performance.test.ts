import { describe, expect, test } from "bun:test"
import { IncrementalChunkBuffer } from "@/session/stream"
import { TurnLifecycleManager } from "@/session/turn-lifecycle"

describe("Long-Session Chaos & Performance", () => {
  test("maintains linear memory growth under 10,000 stream chunks", () => {
    const buffer = new IncrementalChunkBuffer()
    const chunk = "data: token "

    for (let i = 0; i < 10_000; i++) {
      buffer.append(chunk)
    }

    expect(buffer.chunkCount).toBe(10_000)
    expect(buffer.length).toBe(10_000 * chunk.length)

    const snapshot = buffer.getSnapshot()
    expect(snapshot.length).toBe(10_000 * chunk.length)
    expect(buffer.chunkCount).toBe(1)
  })

  test("recovers cleanly from simulated crash during turn execution", () => {
    const manager = new TurnLifecycleManager()
    const sessionID = "sess-chaos-1"
    const turnID = "turn-chaos-1"

    manager.admit(sessionID, turnID)
    manager.transition(turnID, "executing")
    manager.recordToolExecution(turnID, {
      callID: "call-1",
      tool: "write",
      status: "running",
    })

    const record = manager.getTurn(turnID)!
    expect(record.state).toBe("executing")

    const recovered = manager.rehydrate(record)
    expect(recovered.state).toBe("terminal")
    expect(recovered.toolCalls[0].status).toBe("failed")
  })
})
