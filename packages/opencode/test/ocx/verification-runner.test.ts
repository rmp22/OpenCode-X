import { describe, expect, it } from "bun:test"
import { runCheck, runChecks } from "../../src/ocx/verification/runner"
import { validateCompletion } from "../../src/ocx/unified-gate"

describe("VerificationRunner", () => {
  it("executes a passing command and returns PASS status", async () => {
    const res = await runCheck("echo 'ok'")
    expect(res.status).toBe("PASS")
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toBe("ok")
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("executes a failing command and returns FAIL status", async () => {
    const res = await runCheck("exit 42")
    expect(res.status).toBe("FAIL")
    expect(res.exitCode).toBe(42)
  })

  it("handles timeout correctly and returns TIMEOUT status", async () => {
    const res = await runCheck("sleep 2", { timeoutMs: 100 })
    expect(res.status).toBe("TIMEOUT")
    expect(res.exitCode).toBeNull()
    expect(res.error).toContain("Timed out after 100ms")
  })

  it("executes multiple checks sequentially and halts on first failure", async () => {
    const commands = [
      "echo 'first'",
      "exit 1",
      "echo 'third'",
    ]
    const results = await runChecks(commands)
    expect(results.length).toBe(2)
    expect(results[0].status).toBe("PASS")
    expect(results[1].status).toBe("FAIL")
  })
})

describe("UnifiedGate Completion Validation", () => {
  it("rejects completion when checks array is empty", () => {
    const decision = validateCompletion([])
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain("without required verification checks")
  })

  it("rejects completion when any check is not PASS", () => {
    const checks = [
      { status: "PASS", command: "bun test" },
      { status: "FAIL", command: "bun typecheck" },
    ]
    const decision = validateCompletion(checks)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain("1 check(s) not passed")
  })

  it("approves completion when all checks have status PASS", () => {
    const checks = [
      { status: "PASS", command: "bun test" },
      { status: "PASS", command: "bun typecheck" },
    ]
    const decision = validateCompletion(checks)
    expect(decision.allowed).toBe(true)
  })
})
