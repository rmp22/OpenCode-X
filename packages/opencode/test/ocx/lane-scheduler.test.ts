import { describe, expect, test } from "bun:test"
import { LaneScheduler } from "@/ocx/lanes"

describe("LaneScheduler & Concurrency Control", () => {
  test("executes tasks and respects concurrency limit", async () => {
    const scheduler = new LaneScheduler({
      deep: { lane: "deep", concurrency: 1, timeoutMs: 5000, priority: 3 },
    })

    let activeRunning = 0
    let maxRunning = 0

    const makeTask = (ms: number) => async () => {
      activeRunning += 1
      maxRunning = Math.max(maxRunning, activeRunning)
      await new Promise((r) => setTimeout(r, ms))
      activeRunning -= 1
      return "done"
    }

    const p1 = scheduler.enqueue("deep", makeTask(50))
    const p2 = scheduler.enqueue("deep", makeTask(50))

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(maxRunning).toBe(1)
  })

  test("fast lane permits higher concurrency", async () => {
    const scheduler = new LaneScheduler({
      fast: { lane: "fast", concurrency: 4, timeoutMs: 5000, priority: 1 },
    })

    let activeRunning = 0
    let maxRunning = 0

    const makeTask = (ms: number) => async () => {
      activeRunning += 1
      maxRunning = Math.max(maxRunning, activeRunning)
      await new Promise((r) => setTimeout(r, ms))
      activeRunning -= 1
      return "done"
    }

    const promises = [
      scheduler.enqueue("fast", makeTask(40)),
      scheduler.enqueue("fast", makeTask(40)),
      scheduler.enqueue("fast", makeTask(40)),
    ]

    const results = await Promise.all(promises)
    expect(results.every((r) => r.success)).toBe(true)
    expect(maxRunning).toBe(3)
  })

  test("enforces task timeout per lane configuration", async () => {
    const scheduler = new LaneScheduler({
      fast: { lane: "fast", concurrency: 2, timeoutMs: 50, priority: 1 },
    })

    const slowTask = async () => {
      await new Promise((r) => setTimeout(r, 200))
      return "finished"
    }

    const result = await scheduler.enqueue("fast", slowTask)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("timed out after 50ms")
    }
  })

  test("probe lane strictly blocks mutating tools", async () => {
    const scheduler = new LaneScheduler()

    const readTask = async () => "read content"
    const mutateTask = async () => "wrote content"

    const readRes = await scheduler.enqueue("probe", readTask, { toolCategory: "read" })
    expect(readRes.success).toBe(true)

    const mutateRes = await scheduler.enqueue("probe", mutateTask, { toolCategory: "mutate" })
    expect(mutateRes.success).toBe(false)
    if (!mutateRes.success) {
      expect(mutateRes.error).toContain("Probe lane cannot execute mutating tools")
    }
  })

  test("enforces token budget per lane", async () => {
    const scheduler = new LaneScheduler()

    const normalTask = async () => "result"
    const withinBudget = await scheduler.enqueue("interactive", normalTask, { tokenCost: 5000 })
    expect(withinBudget.success).toBe(true)

    const overBudget = await scheduler.enqueue("interactive", normalTask, { tokenCost: 999999 })
    expect(overBudget.success).toBe(false)
    if (!overBudget.success) {
      expect(overBudget.error).toContain("exceeds lane token budget")
    }
  })

  test("respects lane priority preemption order", async () => {
    const executionOrder: string[] = []
    const scheduler = new LaneScheduler({
      batch: { lane: "batch", concurrency: 1, timeoutMs: 5000, priority: 3 },
      interactive: { lane: "interactive", concurrency: 1, timeoutMs: 5000, priority: 1 },
    })

    const makeTask = (name: string, delayMs = 20) => async () => {
      await new Promise((r) => setTimeout(r, delayMs))
      executionOrder.push(name)
      return name
    }

    const pBatch1 = scheduler.enqueue("batch", makeTask("batch1", 50))
    const pBatch2 = scheduler.enqueue("batch", makeTask("batch2", 20))
    const pInteractive = scheduler.enqueue("interactive", makeTask("interactive1", 20))

    await Promise.all([pBatch1, pBatch2, pInteractive])

    expect(executionOrder.indexOf("interactive1")).toBeLessThan(executionOrder.indexOf("batch2"))
  })

  test("research lane permits research tools and supports cancellation", async () => {
    const scheduler = new LaneScheduler({
      research: { lane: "research", concurrency: 1, timeoutMs: 5000, priority: 2 },
    })

    const readTask = async () => "read content"
    const res = await scheduler.enqueue("research", readTask, { toolCategory: "read" })
    expect(res.success).toBe(true)

    const slowTask = () => new Promise((r) => setTimeout(r, 100))
    const p1 = scheduler.enqueue("research", slowTask)
    const p2 = scheduler.enqueue("research", slowTask)
    const p3 = scheduler.enqueue("research", slowTask)

    const cancelledCount = scheduler.cancelLane("research")
    expect(cancelledCount).toBeGreaterThanOrEqual(1)

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect([r1, r2, r3].some((r) => !r.success && r.error?.includes("cancelled"))).toBe(true)
  })
})
