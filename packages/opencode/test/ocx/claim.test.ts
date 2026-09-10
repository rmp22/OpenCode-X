import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import type { LLM } from "../../src/session/llm"
import { OCXDb } from "../../src/ocx/ocx-db"
import { Claim } from "../../src/ocx/turn/claim"
import { ActivityRuntime } from "../../src/ocx/activity/runtime"
import { Ledger } from "../../src/ocx/ledger"
import { State } from "../../src/ocx/turn/state"
import { Workflow } from "../../src/ocx/workflow"
import type { TurnServices } from "../../src/ocx/turn/types"
import { tmpdir } from "../fixture/fixture"

const model = {} as Provider.Model
const user = {} as SessionV1.User

const toolPart = (tool: string, input: Record<string, unknown>, status = "completed", metadata?: Record<string, unknown>) =>
  ({ type: "tool", tool, state: { status, input, ...(metadata ? { metadata } : {}) } }) as unknown as SessionV1.Part

const messages = (parts: readonly SessionV1.Part[], reply: string) =>
  [
    { info: { role: "user", id: "user" }, parts: [] },
    { info: { role: "assistant", id: "assistant" }, parts: [
      { type: "text", text: reply },
      ...parts,
    ] },
  ] as unknown as SessionV1.WithParts[]

const scriptedLlm = (response: string): LLM.Interface => ({
  stream: () => Stream.make(LLMEvent.textDelta({ id: "claim", text: response })),
})

function services(input: {
  cwd: string
  sessionID: string
  llm: LLM.Interface
  review: boolean
  flake: boolean
  verify?: boolean
  runVerify?: TurnServices["verify"]
  patch?: boolean
  store?: OCXDb.Store
  publishWorkflow?: TurnServices["publishWorkflow"]
}): TurnServices {
  return {
    store: input.store ?? OCXDb.memory(),
    todoGet: () => Effect.succeed([]),
    todoSet: () => Effect.void,
    llm: input.llm,
    model,
    user,
    sessionID: input.sessionID,
    cwd: input.cwd,
    ocxVerifyLadder: input.verify ?? false,
    ocxReviewEnvelope: input.review,
    ocxFlakeGate: input.flake,
    ocxPractices: false,
    ocxPatchSelection: input.patch ?? false,
    ...(input.runVerify ? { verify: input.runVerify } : {}),
    publishActivity: () => Effect.void,
    publishWorkflow: input.publishWorkflow ?? (() => Effect.void),
    updatePart: () => Effect.void,
  }
}

const continuingReply = "PHASE: verify DEPTH: standard STATE: active\nReview is still in progress."

describe("Claim Batch A integration", () => {

  test("terminalizes reasoning when a done verdict is accepted", async () => {
    const sessionID = "ses_claim_done_reasoning"
    const events: unknown[] = []
    const checked = services({
      cwd: process.cwd(),
      sessionID,
      review: false,
      flake: false,
      llm: scriptedLlm("unused"),
      publishWorkflow: (event) => Effect.sync(() => void events.push(event)),
    })
    checked.store.set(sessionID, { workflow: "research", phase: "report", phases: [], done: false })

    const result = await Effect.runPromise(
      Claim.run(checked, messages([], "PHASE: report DEPTH: concise STATE: done\nResearch complete."), "user"),
    )

    expect(result.continueTurn).toBe(false)
    expect(checked.store.get(sessionID)?.workflow).toBeUndefined()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ workflow: "research", phase: "report", status: "complete" })
  })

  test("treats needs_input as a hard turn boundary without completing the session", async () => {
    const sessionID = "ses_claim_needs_input"
    const checked = services({
      cwd: process.cwd(),
      sessionID,
      review: true,
      flake: true,
      llm: scriptedLlm(JSON.stringify({ findings: [{ severity: "blocker", quote: "x", message: "unused" }] })),
    })
    checked.store.set(sessionID, {
      workflow: "research",
      phase: "report",
      phases: [],
      done: false,
    })
    checked.store.setWorkflowProposal(sessionID, {
      workflow: "debugging",
      reason: "The next turn needs failure isolation.",
    })

    const result = await Effect.runPromise(
      Claim.run(
        checked,
        messages([], "PHASE: report DEPTH: concise STATE: needs_input\nWhich target should I use?"),
        "user",
      ),
    )

    expect(result.continueTurn).toBe(false)
    expect(checked.store.get(sessionID)?.done).not.toBe(true)
    expect(checked.store.getWorkflowProposal(sessionID)?.workflow).toBe("debugging")
  })

  test("runs the enabled reviewer for a non-terminal reply", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(
          `${directory}/change.ts`,
          ["export const changed = true", ...Array.from({ length: 12 }, (_, index) => `const line${index} = ${index}`)].join("\n"),
        )
      },
    })
    const sessionID = "ses_claim_review"
    const key = State.turnKey(sessionID, "user")
    State.setRound(key, 1)
    try {
      const result = await Effect.runPromise(
        Claim.run(
          services({
            cwd: tmp.path,
            sessionID,
            review: true,
            flake: false,
            llm: scriptedLlm(
              JSON.stringify({
                findings: [{ severity: "blocker", quote: "export const changed = true", message: "unsafe change" }],
              }),
            ),
          }),
          messages(
            [
              toolPart("read", { filePath: "change.ts" }),
              toolPart("edit", { filePath: "change.ts" }),
              toolPart("bash", { command: "bun test" }, "completed", { exit: 0 }),
            ],
            continuingReply,
          ),
          "user",
        ),
      )
      expect(result.continueTurn).toBe(true)
      expect(State.takeFeedback(key)).toContain("R1-review-finding")
    } finally {
      State.clearRound(key)
    }
  })

  test("runs full-tier checks for a non-terminal reply after a failed command", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(
          `${directory}/change.ts`,
          ["export const changed = true", ...Array.from({ length: 12 }, (_, index) => `const line${index} = ${index}`)].join("\n"),
        )
      },
    })
    const sessionID = "ses_claim_flake"
    const key = State.turnKey(sessionID, "user")
    const turnMessages = messages(
      [
        toolPart("read", { filePath: "change.ts" }),
        toolPart("edit", { filePath: "change.ts" }),
        toolPart("bash", { command: "bun test" }, "error"),
        toolPart("bash", { command: "bun test" }, "completed", { exit: 0 }),
      ],
      continuingReply,
    )
    expect(Ledger.rerunFindings(Ledger.ledger(turnMessages))).toHaveLength(1)
    State.setRound(key, 1)
    State.setPipeline(key, {
      changed: false,
      polished: "",
      strategies: [],
      workflow: { name: "coding", phase: "validate", phases: Workflow.PRESETS.coding.phases },
      notice: undefined,
    })
    try {
      const result = await Effect.runPromise(
        Claim.run(
          services({
            cwd: tmp.path,
            sessionID,
            review: false,
            flake: true,
            llm: scriptedLlm(JSON.stringify({ findings: [] })),
          }),
          turnMessages,
          "user",
        ),
      )
      const feedback = State.takeFeedback(key)
      expect({ continueTurn: result.continueTurn, feedback }).toEqual({
        continueTurn: true,
        feedback: expect.stringContaining("C32-rerun-greenwashing"),
      })
    } finally {
      State.clearRound(key)
    }
  })

  test("persists verification evidence emitted by the ladder", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(`${directory}/package.json`, JSON.stringify({ scripts: { test: "true" } }))
        await Bun.write(`${directory}/change.ts`, "export const changed = true\n")
        await Bun.write(`${directory}/change.test.ts`, "export const test = true\n")
      },
    })
    const sessionID = "ses_claim_evidence"
    const checked = services({
      cwd: tmp.path,
      sessionID,
      review: false,
      flake: false,
      verify: true,
      runVerify: () =>
        Effect.succeed({ results: [{ kind: "test", command: "bun test", outcome: "passed", durationMs: 1 }], wallMs: 1 }),
      llm: scriptedLlm("unused"),
    })
    const result = await Effect.runPromise(
      Claim.run(
        checked,
        messages(
          [toolPart("read", { filePath: "change.ts" }), toolPart("edit", { filePath: "change.ts" })],
          continuingReply,
        ),
        "user",
      ),
    )

    expect(result.continueTurn).toBeBoolean()
    expect(checked.store.verifications(sessionID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "test", outcome: "passed", repositoryID: tmp.path }),
      ]),
    )
  })

  test("does not run post-message OCX work for a terminal reply", async () => {
    let calls = 0
    const llm: LLM.Interface = {
      stream: () => {
        calls++
        return Stream.make(LLMEvent.textDelta({ id: "claim", text: "not json" }))
      },
    }
    const result = await Effect.runPromise(
      Claim.run(
        services({ cwd: process.cwd(), sessionID: "ses_claim_terminal", review: false, flake: false, llm }),
        messages([], "PHASE: report DEPTH: concise STATE: done\nFinal response."),
        "user",
      ),
    )
    expect(result.continueTurn).toBe(false)
    expect(calls).toBe(0)
  })

  test("keeps changed-file anti-slop advisories non-blocking", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(`${directory}/ocx-antislop-claim.ts`, "function launchRequestCarriesHeavyResourceMask() { return true }\n")
      },
    })
    const sessionID = "ses_claim_antislop_advisory"
    const key = State.turnKey(sessionID, "user")
    try {
      const result = await Effect.runPromise(
        Claim.run(
          services({ cwd: tmp.path, sessionID, review: false, flake: false, llm: scriptedLlm("unused") }),
          messages(
            [
              toolPart("read", { filePath: "ocx-antislop-claim.ts" }),
              toolPart("edit", { filePath: "ocx-antislop-claim.ts" }),
              toolPart("bash", { command: "bun test" }, "completed", { exit: 0 }),
            ],
            "PHASE: report DEPTH: concise STATE: done\nFinal response.",
          ),
          "user",
        ),
      )

      expect(result.continueTurn).toBe(false)
      expect(State.takeFeedback(key)).toBeUndefined()
    } finally {
      State.clearRound(key)
    }
  })

  test("treats done as absorbing and does not start a post-output reviewer round", async () => {
    let calls = 0
    const llm: LLM.Interface = {
      stream: () => {
        calls++
        return Stream.make(LLMEvent.textDelta({ id: "claim", text: "unused" }))
      },
    }
    const sessionID = "ses_claim_terminal_absorbing"
    const checked = services({ cwd: process.cwd(), sessionID, review: true, flake: true, verify: true, llm })
    checked.store.set(sessionID, {
      workflow: "research",
      phase: "report",
      phases: [],
      done: false,
    })
    const result = await Effect.runPromise(
      Claim.run(
        checked,
        messages([], "PHASE: report DEPTH: concise STATE: done\nFinal response."),
        "user",
      ),
    )
    expect(result.continueTurn).toBe(false)
    expect(calls).toBe(0)
    expect(checked.store.get(sessionID)?.workflow).toBeUndefined()
  })

  test("clears workflow on needs_input terminal verdict", async () => {
    const sessionID = "ses_claim_terminal_needs_input"
    const checked = services({
      cwd: process.cwd(),
      sessionID,
      review: false,
      flake: false,
      llm: scriptedLlm("unused"),
    })
    checked.store.set(sessionID, {
      workflow: "coding",
      phase: "plan",
      phases: [{ id: "plan", goal: "plan" }, { id: "act", goal: "act" }],
      done: false,
    })
    const result = await Effect.runPromise(
      Claim.run(
        checked,
        messages([], "PHASE: plan DEPTH: concise STATE: needs_input\nNeed clarification."),
        "user",
      ),
    )
    expect(result.continueTurn).toBe(false)
    expect(checked.store.get(sessionID)?.workflow).toBeUndefined()
    expect(checked.store.get(sessionID)?.phase).toBeUndefined()
  })

  test("preserves a terminal reply when review finds a blocker", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(
          `${directory}/change.ts`,
          ["export const changed = true", ...Array.from({ length: 12 }, (_, index) => `const line${index} = ${index}`)].join("\n"),
        )
      },
    })
    const sessionID = "ses_claim_terminal_review"
    const checked = services({
      cwd: tmp.path,
      sessionID,
      review: true,
      flake: false,
      llm: scriptedLlm(JSON.stringify({ findings: [{ severity: "blocker", quote: "export const changed = true", message: "unsafe change" }] })),
    })
    checked.store.set(sessionID, { workflow: "coding", phase: "review", phases: Workflow.PRESETS.coding.phases, done: false })
    const key = State.turnKey(sessionID, "user")
    const turn = messages(
      [
        toolPart("read", { filePath: "change.ts" }),
        toolPart("edit", { filePath: "change.ts" }),
        toolPart("bash", { command: "bun test" }, "completed", { exit: 0 }),
      ],
      "PHASE: report DEPTH: concise STATE: done\nFinal response.",
    )
    try {
      const result = await Effect.runPromise(Claim.run(checked, turn, "user"))
      expect(result.continueTurn).toBe(true)
      expect((turn[1]!.parts[0] as Extract<SessionV1.Part, { type: "text" }>).text).toContain("Final response.")
      expect(State.takeFeedback(key)).toContain("R1-review-finding")
      expect(checked.store.get(sessionID)?.done).not.toBe(true)
    } finally {
      State.clearRound(key)
    }
  })

  test("keeps a terminal reply open when code changed without a passing test", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(`${directory}/change.ts`, "export const changed = true\n")
      },
    })
    const sessionID = "ses_claim_terminal_tests"
    const checked = services({ cwd: tmp.path, sessionID, review: false, flake: false, llm: scriptedLlm("unused") })
    checked.store.set(sessionID, {
      workflow: "coding",
      phase: "validate",
      phases: Workflow.PRESETS.coding.phases,
      done: false,
    })
    const key = State.turnKey(sessionID, "user")
    try {
      const result = await Effect.runPromise(
        Claim.run(
          checked,
          messages(
            [
              toolPart("read", { filePath: "change.ts" }),
              toolPart("edit", { filePath: "change.ts" }),
            ],
            "PHASE: report DEPTH: concise STATE: done\nFinal response.",
          ),
          "user",
        ),
      )

      expect(result.continueTurn).toBe(true)
      expect(State.takeFeedback(key)).toContain("C4-tests-not-green")
      expect(checked.store.get(sessionID)?.done).not.toBe(true)
    } finally {
      State.clearRound(key)
    }
  })

  test("preserves premature done while completion work remains", async () => {
    const sessionID = "ses_claim_terminal_todos"
    const checked = {
      ...services({ cwd: process.cwd(), sessionID, review: false, flake: false, llm: scriptedLlm("unused") }),
      todoGet: () => Effect.succeed([{ status: "pending", content: "Finish the review", priority: "high" }]),
    }
    checked.store.set(sessionID, {
      workflow: "research",
      phase: "report",
      phases: [],
      done: false,
    })
    const turn = messages([], "PHASE: report DEPTH: concise STATE: done\nFinal response.")
    const result = await Effect.runPromise(Claim.run(checked, turn, "user"))
    const reply = turn[1]?.parts.find((part) => part.type === "text")
    expect(result.continueTurn).toBe(true)
    expect(reply?.type === "text" ? reply.text : "").toContain("Final response.")
    expect(State.takeFeedback(State.turnKey(sessionID, "user"))).toContain("TODO item(s) remain open")
    expect(checked.store.get(sessionID)?.done).not.toBe(true)
    State.clearRound(State.turnKey(sessionID, "user"))
  })

  test("replaces an unvalidated done verdict with needs_input after repair budget is exhausted", async () => {
    const sessionID = "ses_claim_terminal_exhausted"
    const key = State.turnKey(sessionID, "user")
    State.setRound(key, 3)
    const checked = {
      ...services({ cwd: process.cwd(), sessionID, review: false, flake: false, llm: scriptedLlm("unused") }),
      todoGet: () => Effect.succeed([{ status: "pending", content: "Resolve the blocker", priority: "high" }]),
    }
    checked.store.set(sessionID, { workflow: "research", phase: "report", phases: [], done: false })
    const turn = messages([], "PHASE: report DEPTH: concise STATE: done\nFinal response.")

    try {
      const result = await Effect.runPromise(Claim.run(checked, turn, "user"))
      const reply = (turn[1]!.parts[0] as Extract<SessionV1.Part, { type: "text" }>).text
      expect(result.continueTurn).toBe(false)
      expect(reply).toContain("STATE: needs_input")
      expect(reply.split("\n", 1)[0]).toMatch(/^PHASE: \S+ DEPTH: concise STATE: needs_input$/)
      expect(reply).toContain("C6-open-todos")
      expect(checked.store.get(sessionID)?.done).not.toBe(true)
    } finally {
      State.clearRound(key)
    }
  })

  test("applies only a candidate that improves the failed check", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(`${directory}/package.json`, JSON.stringify({ scripts: { test: "node change.test.js" } }))
        await Bun.write(`${directory}/change.ts`, "fail\n")
        await Bun.write(
          `${directory}/change.test.js`,
          'const fs = require("fs"); process.exit(fs.readFileSync("change.ts", "utf8").includes("pass") ? 0 : 1)\n',
        )
      },
    })
    const sessionID = "ses_claim_patch"
    const key = State.turnKey(sessionID, "user")
    State.setRound(key, 1)
    const responses = [
      JSON.stringify({ candidates: [{ label: "red", files: [{ path: "change.ts", content: "fail\n" }] }] }),
      JSON.stringify({ candidates: [{ label: "green", files: [{ path: "change.ts", content: "pass\n" }] }] }),
    ]
    let responseIndex = 0
    const checked = services({
      cwd: tmp.path,
      sessionID,
      review: false,
      flake: false,
      verify: true,
      patch: true,
      runVerify: () =>
        Effect.succeed({ results: [{ kind: "test", command: "bun test", outcome: "failed", durationMs: 1 }], wallMs: 1 }),
      llm: {
        stream: () => Stream.make(LLMEvent.textDelta({ id: `candidate-${responseIndex}`, text: responses[responseIndex++] ?? "{}" })),
      },
    })
    try {
      const result = await Effect.runPromise(
        Claim.run(
          checked,
          messages(
            [
              toolPart("read", { filePath: "change.ts" }),
              toolPart("edit", { filePath: "change.ts" }),
            ],
            continuingReply,
          ),
          "user",
        ),
      )
      expect(result.continueTurn).toBe(true)
      expect(await Bun.file(`${tmp.path}/change.ts`).text()).toBe("fail\n")
      expect(State.takeFeedback(key)).toContain('Candidate repair "green"')
    } finally {
      State.clearRound(key)
    }
  })

  test("allows completion directly once plan steps are completed without requiring audit phase", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (directory) => {
        await Bun.write(`${directory}/change.ts`, "export const x = 1\n")
      },
    })
    const sessionID = "ses_claim_audit_skip"
    const key = State.turnKey(sessionID, "user")
    const terminalReplyNoAudit = "PHASE: deliver DEPTH: standard STATE: done\nVERIFIED: file_path:1: changed code"
    const checked = services({
      cwd: tmp.path,
      sessionID,
      review: false,
      flake: false,
      verify: false,
      llm: scriptedLlm("{}"),
    })
    checked.store.set(sessionID, {
      workflow: "coding",
      phase: "change",
      phases: [],
      plan: {
        goal: "Test plan",
        revision: 1,
        contextReady: true,
        mutations: [],
        evidence: [],
        activeWorkstreamID: "main",
        activeStepID: "step-1",
        workstreams: [
          {
            id: "main",
            goal: "Main",
            targets: ["change.ts"],
            dependencies: [],
            status: "completed",
            steps: [{ id: "step-1", action: "edit change.ts", targets: ["change.ts"], checks: [], dependencies: [], status: "completed", evidence: [], mutations: [] }],
          },
        ],
      },
    })
    try {
      const result = await Effect.runPromise(
        Claim.run(
          checked,
          messages(
            [
              toolPart("read", { filePath: "change.ts" }),
              toolPart("edit", { filePath: "change.ts" }),
              toolPart("bash", { command: "bun test" }, "completed", { exit: 0 }),
            ],
            terminalReplyNoAudit,
          ),
          "user",
        ),
      )
      expect(result.continueTurn).toBe(false)
      expect(State.takeFeedback(key)).toBeUndefined()
    } finally {
      State.clearRound(key)
    }
  })

  test("marks activity terminal when the final verdict was already posted", async () => {
    const sessionID = "ses_claim_terminal_fallthrough"
    const checked = services({ cwd: process.cwd(), sessionID, review: false, flake: false, llm: scriptedLlm("unused") })
    checked.store.set(sessionID, { workflow: "research", phase: "report", phases: [], done: true })
    const key = State.turnKey(sessionID, "user")
    try {
      const result = await Effect.runPromise(
        Claim.run(checked, messages([], "PHASE: report DEPTH: concise STATE: done\nResearch complete."), "user"),
      )
      expect(result.continueTurn).toBe(false)
      expect(State.takeFeedback(key)).toBeUndefined()
    } finally {
      State.clearRound(key)
    }
  })
})
