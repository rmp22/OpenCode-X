import { describe, expect, test } from "bun:test"
import {
  IncrementalChunkBuffer,
  StreamHotPathPipeline,
  formatSseFrame,
  formatSsePing,
  formatSseTerminal,
} from "@/session/stream"

describe("IncrementalChunkBuffer", () => {
  test("accumulates chunks linearly without redundant splitting", () => {
    const buffer = new IncrementalChunkBuffer()
    buffer.append("chunk-1 ")
    buffer.append("chunk-2 ")
    buffer.append("chunk-3")

    expect(buffer.chunkCount).toBe(3)
    expect(buffer.length).toBe(23)
    expect(buffer.getSnapshot()).toBe("chunk-1 chunk-2 chunk-3")
  })

  test("resets state correctly", () => {
    const buffer = new IncrementalChunkBuffer()
    buffer.append("hello")
    buffer.reset()
    expect(buffer.length).toBe(0)
    expect(buffer.chunkCount).toBe(0)
    expect(buffer.getSnapshot()).toBe("")
  })
})

describe("formatSseFrame", () => {
  test("formats standard SSE messages", () => {
    const formatted = formatSseFrame({
      id: "123",
      event: "update",
      data: "line1\nline2",
      retry: 5000,
    })

    expect(formatted).toBe("id: 123\nevent: update\nretry: 5000\ndata: line1\ndata: line2\n\n")
  })

  test("formats ping and terminal sentinels", () => {
    expect(formatSsePing()).toBe(": ping\n\n")
    expect(formatSseTerminal()).toBe("event: done\ndata: [DONE]\n\n")
  })
})

describe("StreamHotPathPipeline", () => {
  test("streams items in order with backpressure", async () => {
    const pipeline = new StreamHotPathPipeline<number>({ highWaterMark: 4 })
    const itemsReceived: number[] = []

    const consumer = (async () => {
      for await (const item of pipeline) {
        itemsReceived.push(item)
      }
    })()

    for (let i = 0; i < 10; i++) {
      await pipeline.push(i)
    }
    pipeline.end()

    await consumer
    expect(itemsReceived).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test("handles cancellation gracefully", async () => {
    const controller = new AbortController()
    let disconnected = false
    const pipeline = new StreamHotPathPipeline<string>({
      signal: controller.signal,
      onDisconnect: () => {
        disconnected = true
      },
    })

    await pipeline.push("item1")
    controller.abort()

    const canPushMore = await pipeline.push("item2")
    expect(canPushMore).toBe(false)
    expect(disconnected).toBe(true)
  })
})
