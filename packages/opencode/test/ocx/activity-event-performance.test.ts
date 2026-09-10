import { describe, expect, test } from "bun:test"
import { ActivityEventThrottler } from "../../src/ocx/activity/runtime"

describe("Activity Event Performance", () => {
  test("throttler enforces >= 100ms interval on non-state-changing events", () => {
    const throttler = new ActivityEventThrottler()
    const t0 = 1000

    expect(throttler.shouldEmit(false, 100, t0)).toBe(true)
    expect(throttler.shouldEmit(false, 100, t0 + 20)).toBe(false)
    expect(throttler.shouldEmit(false, 100, t0 + 50)).toBe(false)
    expect(throttler.shouldEmit(false, 100, t0 + 99)).toBe(false)
    expect(throttler.shouldEmit(false, 100, t0 + 100)).toBe(true)
  })

  test("state-changing events bypass interval throttle immediately", () => {
    const throttler = new ActivityEventThrottler()
    const t0 = 1000

    expect(throttler.shouldEmit(false, 100, t0)).toBe(true)
    expect(throttler.shouldEmit(false, 100, t0 + 10)).toBe(false)

    expect(throttler.shouldEmit(true, 100, t0 + 15)).toBe(true)
    expect(throttler.shouldEmit(true, 100, t0 + 20)).toBe(true)
  })

  test("bounded queue drops intermediate progress updates when queue exceeds depth limit", () => {
    const throttler = new ActivityEventThrottler()
    const queue: { id: number; isStateChange: boolean }[] = []

    for (let i = 0; i < 50; i++) {
      throttler.enqueueWithBounding(queue, { id: i, isStateChange: false }, 50)
    }
    expect(queue.length).toBe(50)

    throttler.enqueueWithBounding(queue, { id: 999, isStateChange: false }, 50)
    expect(queue.length).toBe(50)

    throttler.enqueueWithBounding(queue, { id: 1000, isStateChange: true }, 50)
    expect(queue.length).toBe(51)
    expect(queue[50].id).toBe(1000)
  })

  test("rapid event cycle executes 10,000 operations with sub-millisecond overhead", () => {
    const throttler = new ActivityEventThrottler()
    const queue: { id: number; isStateChange: boolean }[] = []

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      const isStateChange = i % 100 === 0
      throttler.enqueueWithBounding(queue, { id: i, isStateChange }, 50)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100)
    expect(queue.length).toBeLessThanOrEqual(150)
  })
})
