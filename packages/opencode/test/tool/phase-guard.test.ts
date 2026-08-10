import { describe, expect, test } from "bun:test"
import { PhaseGuard } from "../../src/tool/phase-guard"

describe("PhaseGuard codegen injection", () => {
  test("asks for strategy selection before a non-strategy first call", () => {
    PhaseGuard.recordToolCall("strategy-gate", "read", { filePath: "/tmp/target.ts" })
    expect(PhaseGuard.takeReminders("strategy-gate").join("\n")).toContain("Before the first mutation")
  })

  test("blocks a built-in mutation until base strategies and structure load", () => {
    expect(PhaseGuard.mutationGate("mutation-gate", "write", { filePath: "/tmp/target.ts" })).toContain(
      "quality, write, engineering, stack",
    )
    PhaseGuard.recordToolResult(
      "mutation-gate",
      "strategy",
      { names: ["quality", "write", "engineering", "stack"] },
      { strategies: ["quality", "write", "engineering", "stack"] },
    )
    expect(PhaseGuard.mutationGate("mutation-gate", "write", { filePath: "/tmp/target.ts" })).toContain(
      "Call the structure tool",
    )
    PhaseGuard.recordToolResult("mutation-gate", "structure", {}, {})
    expect(PhaseGuard.mutationGate("mutation-gate", "write", { filePath: "/tmp/target.ts" })).toBeUndefined()
  })

  test("does not repeat the strategy gate after required strategies load", () => {
    PhaseGuard.recordToolCall("strategy-loaded", "strategy", { names: ["write", "engineering", "stack", "quality"] })
    PhaseGuard.recordToolResult(
      "strategy-loaded",
      "strategy",
      { names: ["write", "engineering", "stack", "quality"] },
      { strategies: ["write", "engineering", "stack", "quality"] },
    )
    PhaseGuard.recordToolResult("strategy-loaded", "structure", {}, {})
    PhaseGuard.recordToolCall("strategy-loaded", "write", { filePath: "/tmp/target.ts" })
    expect(PhaseGuard.takeReminders("strategy-loaded").join("\n")).not.toContain("Before the first mutation")
  })

  test("requires structure before mutation and audit before verification", () => {
    const sessionID = "contract-gate"
    PhaseGuard.recordToolResult(
      sessionID,
      "strategy",
      { names: ["quality", "write", "engineering", "stack"] },
      { strategies: ["quality", "write", "engineering", "stack"] },
    )
    expect(PhaseGuard.toolGate(sessionID, "write", { filePath: "/tmp/target.ts" })).toContain("Call the structure tool")
    PhaseGuard.recordToolResult(sessionID, "structure", {}, {})
    expect(PhaseGuard.toolGate(sessionID, "write", { filePath: "/tmp/target.ts" })).toBeUndefined()
    PhaseGuard.recordToolCall(sessionID, "write", { filePath: "/tmp/target.ts" })
    expect(PhaseGuard.toolGate(sessionID, "bash", { command: "bun test" })).toContain("Call the audit tool")
    PhaseGuard.recordToolResult(sessionID, "audit", {}, {})
    expect(PhaseGuard.toolGate(sessionID, "bash", { command: "bun test" })).toBeUndefined()
  })

  test("requires a design direction when UI strategies are selected", () => {
    const sessionID = "design-gate"
    PhaseGuard.recordToolResult(
      sessionID,
      "strategy",
      { names: ["quality", "write", "engineering", "stack", "ui"] },
      { strategies: ["quality", "write", "engineering", "stack", "ui"] },
    )
    PhaseGuard.recordToolResult(sessionID, "structure", {}, {})
    expect(PhaseGuard.toolGate(sessionID, "write", { filePath: "/tmp/index.html" })).toContain("Call the design tool")
    PhaseGuard.recordToolResult(sessionID, "design", {}, {})
    expect(PhaseGuard.toolGate(sessionID, "write", { filePath: "/tmp/index.html" })).toContain(
      "Load the fonts strategy",
    )
    PhaseGuard.recordToolResult(sessionID, "strategy", { names: ["fonts"] }, { strategies: ["fonts"] })
    expect(PhaseGuard.toolGate(sessionID, "write", { filePath: "/tmp/index.html" })).toBeUndefined()
  })

  test("requires the fonts strategy before a screen mutation", () => {
    const sessionID = "fonts-gate"
    PhaseGuard.recordToolResult(
      sessionID,
      "strategy",
      { names: ["quality", "write", "engineering", "stack", "web-design"] },
      { strategies: ["quality", "write", "engineering", "stack", "web-design"] },
    )
    PhaseGuard.recordToolResult(sessionID, "structure", {}, {})
    PhaseGuard.recordToolResult(sessionID, "design", {}, {})
    expect(PhaseGuard.toolGate(sessionID, "write", { filePath: "/tmp/index.html" })).toContain(
      "Load the fonts strategy",
    )
    PhaseGuard.recordToolResult(sessionID, "strategy", { names: ["fonts"] }, { strategies: ["fonts"] })
    expect(PhaseGuard.toolGate(sessionID, "write", { filePath: "/tmp/index.html" })).toBeUndefined()
  })

  test("injects compact UI guidance into a screen mutation", () => {
    const sessionID = "ui-codegen"
    PhaseGuard.recordToolResult(sessionID, "strategy", { names: ["ui"] }, { strategies: ["ui"] })
    PhaseGuard.recordToolCall(sessionID, "write", { filePath: "/tmp/index.html" })
    const output = PhaseGuard.takeReminders(sessionID).join("\n")
    expect(output).toContain("Reject fake proof, generic benefits, copied templates")
    expect(output.match(/=== UI DESIGN CORE ===/g)).toHaveLength(1)
  })

  test("requires audit and verification before completion after mutation", () => {
    const sessionID = "completion-gate"
    PhaseGuard.recordToolResult(sessionID, "structure", {}, {})
    PhaseGuard.recordToolCall(sessionID, "write", { filePath: "/tmp/target.ts" })
    expect(PhaseGuard.requireCompletion(sessionID)).toBe(true)
    expect(PhaseGuard.takeReminders(sessionID).join("\n")).toContain("Call the audit tool")
    PhaseGuard.recordToolResult(sessionID, "audit", {}, {})
    expect(PhaseGuard.requireCompletion(sessionID)).toBe(true)
    expect(PhaseGuard.takeReminders(sessionID).join("\n")).toContain("passing verification")
    PhaseGuard.recordToolResult(sessionID, "bash", { command: "bun test" }, { exit: 0 })
    expect(PhaseGuard.requireCompletion(sessionID)).toBe(false)
  })

  test("requires the audit strategy before the audit tool", () => {
    const sessionID = "audit-strategy-gate"
    expect(PhaseGuard.toolGate(sessionID, "audit", {})).toContain("Load the audit strategy")
    PhaseGuard.recordToolResult(sessionID, "strategy", { name: "audit" }, { strategies: ["audit"] })
    expect(PhaseGuard.toolGate(sessionID, "audit", {})).toBeUndefined()
  })

  test("includes the selected language adapter in the first codegen bundle", () => {
    PhaseGuard.recordToolCall("codegen-language", "strategy", { names: ["kotlin", "java", "compose"] })
    PhaseGuard.recordToolResult(
      "codegen-language",
      "strategy",
      { names: ["kotlin", "java", "compose"] },
      { strategies: ["kotlin", "java", "compose"] },
    )
    PhaseGuard.recordToolCall("codegen-language", "write", { filePath: "/tmp/target.kt" })
    const output = PhaseGuard.takeReminders("codegen-language").join("\n")
    expect(output).toContain("Use a data class for immutable value objects")
    expect(output).toContain("Use a record for an immutable data carrier")
    expect(output).toContain("commonMain")
  })

  test("tracks every apply_patch path", () => {
    PhaseGuard.recordToolCall("patch-paths", "apply_patch", {
      patchText: "*** Update File: /tmp/one.ts\n*** Add File: /tmp/two.ts",
    })
    const output = PhaseGuard.takeReminders("patch-paths").join("\n")
    expect(output).toContain("Read /tmp/one.ts")
    expect(output).toContain("Read /tmp/two.ts")
    expect(output).toContain("/tmp/one.ts, /tmp/two.ts")
  })

  test("tracks shell writes as mutations", () => {
    PhaseGuard.recordToolCall("shell-write", "bash", { command: "mkdir -p /tmp/new-output" })
    expect(PhaseGuard.takeReminders("shell-write").join("\n")).toContain("mkdir -p /tmp/new-output")
  })

  test("injects the codegen bundle on the first mutation", () => {
    PhaseGuard.recordToolCall("first-mutation", "write", { filePath: "/tmp/target.ts" })
    const reminders = PhaseGuard.takeReminders("first-mutation")
    const output = reminders.join("\n")
    expect(output).toContain("=== CODE WRITING ===")
    expect(output).toContain("Make code correct, then fast, then clean.")
    expect(output).toContain("No `!!` in Kotlin. No `*Util` or `*Helper` names. No generic catch.")
    expect(output).toContain("Verify every imported package")
    expect(output).toContain("No hallucinated imports")
    expect(output).toContain("For a screen, load the selected ui, browser, and audit strategies before delivery")
    expect(output).toContain("Use simple English: short active sentences")
    expect(output).not.toContain("=== SIMPLE ENGLISH ===")
    expect(output).toContain("Split files at real responsibility")
    expect(output.lastIndexOf("Use simple English:")).toBeGreaterThan(output.indexOf("=== CLEAN CODE CHECK ==="))
  })

  test("injects the bundle once across repeated mutations", () => {
    PhaseGuard.recordToolCall("repeated-mutations", "write", { filePath: "/tmp/a.ts" })
    PhaseGuard.recordToolCall("repeated-mutations", "edit", { filePath: "/tmp/b.ts" })
    const reminders = PhaseGuard.takeReminders("repeated-mutations")
    expect(reminders.join("\n").match(/=== CODE WRITING ===/g)).toHaveLength(1)
    expect(reminders.join("\n").match(/No `!!` in Kotlin/g)).toHaveLength(1)
  })

  test("stays out of non-mutating turns", () => {
    PhaseGuard.recordToolCall("no-mutation", "bash", { command: "ls" })
    PhaseGuard.recordToolCall("no-mutation", "read", { filePath: "/tmp/b.ts" })
    const reminders = PhaseGuard.takeReminders("no-mutation")
    expect(reminders.join("\n")).not.toContain("= CODE WRITING ===")
  })

  test("warns when a file is read again without a change", () => {
    PhaseGuard.recordToolCall("re-read", "read", { filePath: "/tmp/a.ts" })
    PhaseGuard.recordToolCall("re-read", "read", { filePath: "/tmp/a.ts" })
    const reminders = PhaseGuard.takeReminders("re-read")
    expect(reminders.join("\n")).toContain("You read /tmp/a.ts before.")
  })

  test("allows a fresh read after the file changed", () => {
    PhaseGuard.recordToolCall("changed-read", "read", { filePath: "/tmp/a.ts" })
    PhaseGuard.recordToolCall("changed-read", "edit", { filePath: "/tmp/a.ts" })
    const afterEdit = PhaseGuard.takeReminders("changed-read")
    expect(afterEdit.join("\n")).not.toContain("You read /tmp/a.ts before.")
    PhaseGuard.recordToolCall("changed-read", "read", { filePath: "/tmp/a.ts" })
    const afterRead = PhaseGuard.takeReminders("changed-read")
    expect(afterRead.join("\n")).not.toContain("You read /tmp/a.ts before.")
  })

  test("injects a budget warning at 8 calls without a mutation", () => {
    for (let i = 0; i < 8; i++) {
      PhaseGuard.recordToolCall("budget", "read", { filePath: `/tmp/c${i}.ts` })
    }
    const reminders = PhaseGuard.takeReminders("budget")
    expect(reminders.join("\n")).toContain("You made 8 calls without a mutation.")
  })

  test("resets the budget counter on a mutation", () => {
    for (let i = 0; i < 7; i++) {
      PhaseGuard.recordToolCall("budget-reset", "read", { filePath: `/tmp/d${i}.ts` })
    }
    PhaseGuard.recordToolCall("budget-reset", "write", { filePath: "/tmp/done.ts" })
    PhaseGuard.recordToolCall("budget-reset", "read", { filePath: "/tmp/e1.ts" })
    const reminders = PhaseGuard.takeReminders("budget-reset")
    expect(reminders.join("\n")).not.toContain("You made 8 calls and no mutation.")
  })

  test("warns at task-wide tool budgets", () => {
    for (let i = 0; i < 12; i++) {
      PhaseGuard.recordToolCall("task-budget", "read", { filePath: `/tmp/task-${i}.ts` })
    }
    expect(PhaseGuard.takeReminders("task-budget").join("\n")).toContain("You used 12 tool calls in this session.")
  })

  test("keeps the web security standard out of the codegen bundle", () => {
    PhaseGuard.recordToolCall("server-mutation", "write", { filePath: "/tmp/server.py" })
    const reminders = PhaseGuard.takeReminders("server-mutation")
    expect(reminders.join("\n")).not.toContain("=== WEB SECURITY ===")
  })

  test("creates a verification obligation after mutation", () => {
    PhaseGuard.recordToolCall("verification-required", "write", { filePath: "/tmp/changed.ts" })
    expect(PhaseGuard.takeReminders("verification-required").join("\n")).toContain(
      "The last mutation changed /tmp/changed.ts.",
    )
  })

  test("clears the obligation after a passing verification command", () => {
    PhaseGuard.recordToolCall("verification-pass", "write", { filePath: "/tmp/changed.ts" })
    PhaseGuard.takeReminders("verification-pass")
    PhaseGuard.recordToolResult("verification-pass", "bash", { command: "bun test" }, { exit: 0 })
    PhaseGuard.recordToolCall("verification-pass", "write", { filePath: "/tmp/next.ts" })
    expect(PhaseGuard.takeReminders("verification-pass").join("\n")).not.toContain(
      "The last mutation changed /tmp/changed.ts.",
    )
  })

  test("keeps failed verification visible", () => {
    PhaseGuard.recordToolCall("verification-fail", "write", { filePath: "/tmp/changed.ts" })
    PhaseGuard.takeReminders("verification-fail")
    PhaseGuard.recordToolResult("verification-fail", "bash", { command: "bun test" }, { exit: 1 })
    expect(PhaseGuard.takeReminders("verification-fail").join("\n")).toContain(
      "The relevant verifier failed after the last mutation.",
    )
    PhaseGuard.recordToolCall("verification-fail", "read", { filePath: "/tmp/next.ts" })
    expect(PhaseGuard.takeReminders("verification-fail").join("\n")).toContain(
      "The last mutation changed /tmp/changed.ts.",
    )
  })

  test("does not treat an unrelated shell command as verification", () => {
    PhaseGuard.recordToolCall("verification-unrelated", "write", { filePath: "/tmp/changed.ts" })
    PhaseGuard.takeReminders("verification-unrelated")
    PhaseGuard.recordToolResult("verification-unrelated", "bash", { command: "ls" }, { exit: 0 })
    PhaseGuard.recordToolCall("verification-unrelated", "write", { filePath: "/tmp/next.ts" })
    expect(PhaseGuard.takeReminders("verification-unrelated").join("\n")).toContain(
      "The last mutation changed /tmp/changed.ts.",
    )
  })
})
