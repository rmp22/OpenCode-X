import { describe, expect, test } from "bun:test"
import { CapabilityRouter } from "@/ocx/tools/router"

describe("CapabilityRouter", () => {
  test("routes registered tools and captures telemetry and evidence", async () => {
    const router = new CapabilityRouter()
    router.registerTool({
      name: "echo",
      description: "Echo input",
      requiredCapabilities: ["read"],
      execute: async (input: { msg: string }) => `Echo: ${input.msg}`,
    })

    const result = await router.execute("echo", { msg: "hello" })
    expect(result.status).toBe("success")
    expect(result.data).toBe("Echo: hello")
    expect(result.evidence).toBeDefined()
    expect(result.telemetry.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("handles missing tools cleanly with recovery hints", async () => {
    const router = new CapabilityRouter()
    const result = await router.execute("unknown", {})
    expect(result.status).toBe("failure")
    expect(result.error?.code).toBe("TOOL_NOT_FOUND")
    expect(result.error?.recoveryHint).toBeDefined()
  })

  test("auto-truncates oversized output", async () => {
    const router = new CapabilityRouter()
    router.registerTool({
      name: "big",
      description: "Big output",
      requiredCapabilities: [],
      maxOutputBytes: 10,
      execute: async () => "12345678901234567890",
    })

    const result = await router.execute("big", {})
    expect(result.status).toBe("partial")
    expect(result.truncated).toBe(true)
    expect(result.continuationToken).toBeDefined()
  })
})
