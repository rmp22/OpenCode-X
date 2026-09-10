import { describe, expect, test } from "bun:test"
import { MutationGuard } from "../../src/ocx/mutation-guard"

const header = {
  type: "tool",
  tool: "ocx_header",
  state: { status: "completed", input: { workflow: "codegen", intents: ["codegen"] } },
} as const

const structure = {
  type: "tool",
  tool: "structure",
  state: { status: "completed", metadata: { paths: ["src/fix.ts"] } },
} as const

const messages = (parts: readonly unknown[]) => [{ info: { role: "assistant", id: "assistant" }, parts }]

describe("mutation guard", () => {
  test("does not require structure evidence before codegen writes", () => {
    expect(MutationGuard.check(messages([header]), "/repo", ["/repo/src/fix.ts"])).toBeUndefined()
  })

  test("does not treat an invalid completed structure call as contract evidence", () => {
    const invalidStructure = {
      type: "tool",
      tool: "structure",
      state: { status: "completed", metadata: { paths: [], files: 0 } },
    } as const
    const context = MutationGuard.fromMessages(messages([header, invalidStructure]))
    expect(MutationGuard.check(messages([header, invalidStructure]), "/repo", ["/repo/src/fix.ts"], context)).toBeUndefined()
  })

  test("does not use structure paths as a second mutation scope", () => {
    expect(MutationGuard.check(messages([header, structure]), "/repo", ["/repo/src/other.ts"])).toBeUndefined()
  })

  test("allows planned code and non-code paths", () => {
    expect(MutationGuard.check(messages([header, structure]), "/repo", ["/repo/src/fix.ts"])).toBeUndefined()
    expect(MutationGuard.check(messages([header]), "/repo", ["/repo/notes.md"])).toBeUndefined()
  })

  test("allows non-code research writes", () => {
    const research = { ...header, state: { ...header.state, input: { workflow: "research", intents: ["research"] } } }
    expect(MutationGuard.check(messages([research]), "/repo", ["/repo/notes.md"])).toBeUndefined()
  })

  test("structure remains optional metadata in the same step", () => {
    const context = MutationGuard.fromMessages([])
    expect(MutationGuard.check([], "/repo", ["/repo/src/fix.ts"], context)).toBeUndefined()
    MutationGuard.recordHeader(context)
    expect(MutationGuard.check([], "/repo", ["/repo/src/fix.ts"], context)).toBeUndefined()
    MutationGuard.recordStructure(context, ["src/fix.ts"])
    expect(MutationGuard.check([], "/repo", ["/repo/src/other.ts"], context)).toBeUndefined()
  })

  test("locks debugging mutations until a failing run exists", () => {
    const debugging = {
      ...header,
      state: { ...header.state, input: { workflow: "debugging", intents: ["debug"] } },
    }
    const history = [...messages([debugging]), ...messages([structure])]
    const context = MutationGuard.fromMessages(history)
    expect(MutationGuard.check(history, "/repo", ["/repo/src/fix.ts"], context)?.rule).toBe("mutation-debugging")
    expect(
      MutationGuard.check(
        [
          { info: { role: "assistant", id: "assistant-2" }, parts: [debugging, structure] },
          {
            info: { role: "assistant", id: "assistant-3" },
            parts: [{ type: "tool", tool: "bash", state: { status: "completed", input: { command: "bun test" }, metadata: { exit: 1 } } }],
          },
        ] as never,
        "/repo",
        ["/repo/src/fix.ts"],
        context,
      ),
    ).toBeUndefined()
  })

  test("accepted execution plan replaces the legacy header plan requirement", () => {
    const context = MutationGuard.fromMessages([])
    MutationGuard.recordHeader(context, { workflowName: "codegen", plan: [], workstreams: [] } as never)
    MutationGuard.recordPlan(context)
    MutationGuard.recordStructure(context, ["src/fix.ts"])
    expect(MutationGuard.check([], "/repo", ["/repo/src/fix.ts"], context)).toBeUndefined()
  })

  test("rejects a coding header without the required plan and workstream", () => {
    const incomplete = {
      ...header,
      state: {
        ...header.state,
        metadata: { valid: true, codingContract: true, planSteps: 1, workstreams: 0 },
      },
    }
    expect(MutationGuard.check(messages([incomplete]), "/repo", ["/repo/src/fix.ts"])?.rule).toBe("mutation-plan")
  })

  test("rejects a mutation that conflicts with an explicit user prohibition", () => {
    const history = [
      { info: { role: "user", id: "user" }, parts: [{ type: "text", text: "Implement the fix; do not change src/generated.ts" }] },
      {
        info: { role: "assistant", id: "assistant" },
        parts: [header, { ...structure, state: { ...structure.state, metadata: { paths: ["src/generated.ts"] } } }],
      },
    ] as never
    expect(MutationGuard.check(history, "/repo", ["/repo/src/generated.ts"])?.rule).toBe("mutation-intent")
  })

  test("recognizes the selected greenfield workflow in the mutation context", () => {
    const context = MutationGuard.fromMessages([
      {
        parts: [
          {
            type: "tool",
            tool: "ocx_header",
            state: { status: "completed", input: { workflow: "greenfield" }, metadata: { workflow: "greenfield" } },
          },
        ],
      },
    ] as never)
    expect(MutationGuard.requiresAbstraction(context)).toBe(true)
  })
})
