import { describe, expect, test } from "bun:test"
import { OperationClassifier } from "../../src/ocx/operation-classifier"
import { AgentOrientation } from "../../src/ocx/orientation"
import { PlanWorkstreamState } from "../../src/ocx/plan-workstream-state"
import { SessionDone } from "../../src/ocx/session-done"
import { SlopSignalScanner } from "../../src/ocx/antislop/scanner"
import { BatchingAdvisor, type ToolCallPlan } from "../../src/ocx/batching"
import { SystemPrompt } from "../../src/session/system"
import { TodoSync } from "../../src/ocx/todo/sync"
import type { TodoItem } from "../../src/ocx/todo/agent"
import { Workflow } from "../../src/ocx/workflow"
import { WorkflowV2 } from "../../src/ocx/workflow-v2"

describe("OCX invariants", () => {
  test("scans source rules without treating comments or ordinary CSS as code blockers", () => {
    const comment = SlopSignalScanner.scan({ path: "src/example.ts", content: "// eval(input)\nconst value = true" })
    const css = SlopSignalScanner.scan({ path: "styles.css", content: ".card { color: red; }" })
    const unsafe = SlopSignalScanner.scan({ path: "src/unsafe.ts", content: "eval(input)" })

    expect(comment.signals.some((signal) => signal.id === "S-dangerous-eval")).toBe(false)
    expect(css.signals).toEqual([])
    expect(unsafe.signals.some((signal) => signal.id === "S-dangerous-eval" && signal.severity === "block")).toBe(true)
  })

  test("reports unsupported and unreadable artifacts instead of silently skipping them", () => {
    const unsupported = SlopSignalScanner.scan({ path: "assets/logo.png", content: "binary" })
    const unreadable = SlopSignalScanner.scanFiles({ files: [{ path: "src/missing.ts" }] })

    expect(unsupported.notices).toEqual([{ path: "assets/logo.png", status: "unsupported" }])
    expect(unreadable.notices[0]?.status).toBe("unreadable")
  })

  test("prioritizes explicit implementation intent over documentation mentions", () => {
    expect(OperationClassifier.classifyRequest("audit the source and implement the confirmed fixes")?.surface).toBe("code")
    expect(OperationClassifier.classifyRequest("update the README documentation")?.surface).toBe("documentation")
  })

  test("resolves tool aliases canonically in WorkflowV2 Gate", () => {
    const edit = WorkflowV2.Gate.resolveToolName("edit")
    const replace = WorkflowV2.Gate.resolveToolName("replace")
    const unknown = WorkflowV2.Gate.resolveToolName("unknown_custom_tool")

    expect(edit?.canonicalName).toBe("edit")
    expect(replace?.canonicalName).toBe("edit")
    expect(unknown).toBeUndefined()
  })

  test("keeps pipeline orientation compact and dynamic", () => {
    const orientation = AgentOrientation.formatCapabilityOrientation({ workflow: "coding", phase: "change", availableTools: ["read", "edit", "shell"] })
    const pipelinePrompt = SystemPrompt.provider({ mode: "primary", pipeline: true }).join("\n")
    const regularPrompt = SystemPrompt.provider({ mode: "primary" }).join("\n")

    expect(orientation).toContain("workflow=coding; phase=change")
    expect(orientation).toContain("Relevant tools: read, edit, shell")
    expect(pipelinePrompt).not.toContain("STRATEGY CATALOG")
    expect(pipelinePrompt.length).toBeLessThan(regularPrompt.length)
  })

  test("preserves open todos when done is not verified", () => {
    const open: TodoItem[] = [{ content: "unfinished", status: "pending", priority: "high" }]
    const closed: TodoItem[] = [{ content: "finished", status: "completed", priority: "high" }]

    expect(TodoSync.reconcileTerminalState(open, "done")).toEqual(open)
    expect(TodoSync.reconcileTerminalState(closed, "done")).toEqual([])
    expect(TodoSync.reconcileTerminalState(open, "cancelled")[0]?.status).toBe("cancelled")
  })

  test("requires an observable check for every parsed plan step", () => {
    const parsed = PlanWorkstreamState.parseExecutionPlan(["goal=Ship change", "workstream=implementation", "  step=Write source", "    target=src"].join("\n"))

    expect(parsed.plan).toBeUndefined()
    expect(parsed.errors.some((error) => error.key.endsWith(".check"))).toBe(true)
  })

  test("recognizes cancelled terminal dispositions without rewriting normal work", () => {
    expect(SessionDone.disposition("PHASE: deliver DEPTH: concise STATE: cancelled")).toBe("cancelled")
    expect(SessionDone.disposition("PHASE: act DEPTH: concise STATE: working")).toBe("working")
  })

  test("batches independent reads while preserving mutation and barrier order", () => {
    const reads: ToolCallPlan[] = [
      { name: "read-a", kind: "read", path: "a", batched: false },
      { name: "read-b", kind: "read", path: "b", batched: false },
    ]
    const ordered: ToolCallPlan[] = [
      { name: "write-a", kind: "write", path: "a" },
      { name: "read-a", kind: "read", path: "a" },
      { name: "barrier", kind: "barrier", sequential: true },
    ]
    const duplicate: ToolCallPlan[] = [
      { name: "read-a-1", kind: "read", path: "a" },
      { name: "read-a-2", kind: "read", path: "a" },
    ]

    expect(BatchingAdvisor.analyzeBatch(reads).parallelGroups[0]).toHaveLength(2)
    expect(BatchingAdvisor.analyzeBatch(ordered).parallelGroups.flatMap((group) => group.map((call) => call.name))).toEqual(["write-a", "read-a", "barrier"])
    expect(BatchingAdvisor.detectInefficiencies(duplicate).repeatedReads).toEqual(["a"])
    expect(BatchingAdvisor.analyzeBatch(ordered).hazards.some((hazard) => hazard.kind === "barrier")).toBe(true)
  })
})
