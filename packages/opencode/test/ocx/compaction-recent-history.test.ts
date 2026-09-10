import { describe, expect } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Effect, Layer, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Config } from "@/config/config"
import { LLM } from "../../src/session/llm"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "@/util/token"
import { TestInstance } from "../fixture/fixture"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Provider } from "@/provider/provider"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { TestConfig } from "../fixture/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LLMEvent, Usage } from "@opencode-ai/llm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const usage = (input: ConstructorParameters<typeof Usage>[0]) => new Usage(input)

const basicUsage = () => usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const wide = () => ProviderTest.fake({ model: createModel({ context: 100_000, output: 32_000 }) })

function createUserMessage(sessionID: SessionID, text: string) {
  return Effect.gen(function* () {
    const ssn = yield* SessionNs.Service
    const msg = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: ref,
      time: { created: Date.now() },
    })
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID,
      type: "text",
      text,
    })
    return msg
  })
}

function createAssistantMessage(sessionID: SessionID, parentID: MessageID, root: string) {
  return SessionNs.Service.use((ssn) =>
    ssn.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      sessionID,
      mode: "build",
      agent: "build",
      path: { cwd: root, root },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: ref.modelID,
      providerID: ref.providerID,
      parentID,
      time: { created: Date.now() },
      finish: "end_turn",
    }),
  )
}

type CompactionProcessOptions = {
  readonly llm: Layer.Layer<LLM.Service>
  readonly provider?: ReturnType<typeof wide>
  readonly config?: Layer.Layer<Config.Service>
}

const compactionTestNode = LayerNode.group([
  SessionCompaction.node,
  SessionNs.node,
  SessionProjector.node,
  Database.node,
  EventV2Bridge.node,
  CrossSpawnSpawner.node,
])

const compactionEnv = AppNodeBuilder.build(
  LayerNode.group([SessionNs.node, SessionProjector.node, Database.node, EventV2Bridge.node, CrossSpawnSpawner.node]),
)
const itCompaction = testEffect(compactionEnv)

function withCompaction(options: CompactionProcessOptions) {
  return Effect.provide(
    AppNodeBuilder.build(compactionTestNode, [
      [Provider.node, (options.provider ?? wide()).layer],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
      [SessionSummary.node, summary],
      [LLM.node, options.llm],
      ...(options.config ? ([[Config.node, options.config]] as const) : []),
    ]),
  )
}

function createSummaryCompaction(sessionID: SessionID) {
  return SessionCompaction.use.create({ sessionID, agent: "build", model: ref, auto: false })
}

function readCompactionPart(sessionID: SessionID) {
  return SessionNs.use
    .messages({ sessionID })
    .pipe(
      Effect.map((messages) =>
        messages.at(-2)?.parts.find((item): item is SessionV1.CompactionPart => item.type === "compaction"),
      ),
    )
}

function llm() {
  const queue: Array<
    Stream.Stream<LLMEvent, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLMEvent, unknown>)
  > = []

  return {
    push(stream: Stream.Stream<LLMEvent, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLMEvent, unknown>)) {
      queue.push(stream)
    },
    llmLayer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          const item = queue.shift() ?? Stream.empty
          const stream = typeof item === "function" ? item(input) : item
          return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
        },
      }),
    ),
  }
}

function reply(
  text: string,
  capture?: (input: LLM.StreamInput) => void,
): (input: LLM.StreamInput) => Stream.Stream<LLMEvent, unknown> {
  return (input) => {
    capture?.(input)
    return Stream.make(
      LLMEvent.textStart({ id: "txt-0" }),
      LLMEvent.textDelta({ id: "txt-0", text }),
      LLMEvent.textEnd({ id: "txt-0" }),
      LLMEvent.stepFinish({
        index: 0,
        reason: "stop",
        usage: basicUsage(),
      }),
      LLMEvent.finish({
        reason: "stop",
        usage: basicUsage(),
      }),
    )
  }
}

function cfg(compaction?: ConfigV1.Info["compaction"]) {
  const base = Schema.decodeUnknownSync(ConfigV1.Info)({}) as ConfigV1.Info
  return Layer.succeed(Config.Service, TestConfig.make({ get: () => Effect.succeed({ ...base, compaction }) }))
}

function createToolTurn(sessionID: SessionID, root: string, userText: string, output: string) {
  return SessionNs.Service.use((ssn) =>
    Effect.gen(function* () {
      const user = yield* ssn.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      })
      yield* ssn.updatePart({
        id: PartID.ascending(),
        messageID: user.id,
        sessionID,
        type: "text",
        text: userText,
      })
      const assistant: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        sessionID,
        mode: "build",
        agent: "build",
        path: { cwd: root, root },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: ref.modelID,
        providerID: ref.providerID,
        parentID: user.id,
        time: { created: Date.now() },
        finish: "end_turn",
      }
      yield* ssn.updateMessage(assistant)
      yield* ssn.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID,
        type: "tool",
        callID: crypto.randomUUID(),
        tool: "bash",
        state: {
          status: "completed",
          input: {},
          output,
          title: "done",
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
        },
      })
      return { user, assistant }
    }),
  )
}

function estimateTailTokens(sessionID: SessionID, tailStartID: MessageID, model: Provider.Model) {
  return Effect.gen(function* () {
    const msgs = yield* SessionNs.use.messages({ sessionID })
    const start = msgs.findIndex((msg) => msg.info.id === tailStartID)
    if (start < 0) return -1
    const modelMsgs = yield* MessageV2.toModelMessagesEffect(msgs.slice(start), model)
    return Token.estimate(JSON.stringify(modelMsgs))
  })
}

describe("session.compaction.recent-history", () => {
  itCompaction.instance(
    "keeps recent continuity for a light fifty-message window",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        const users: SessionV1.User[] = []
        for (let index = 0; index < 50; index++) {
          users.push(yield* createUserMessage(session.id, `light-${index}`))
        }
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBe(users[48]!.id)
        expect(captured).toContain("light-0")
        expect(captured).not.toContain("light-49")
        expect(
          yield* estimateTailTokens(session.id, part!.tail_start_id!, createModel({ context: 100_000, output: 32_000 })),
        ).toBeLessThanOrEqual(8_000)

        const filtered = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        const texts = filtered
          .flatMap((msg) => msg.parts.map((part) => (part.type === "text" ? part.text : "")))
          .join("\n")
        expect(texts).toContain("light-48")
        expect(texts).toContain("light-49")
      }).pipe(withCompaction({ llm: stub.llmLayer }))
    },
    { git: true },
  )

  itCompaction.instance(
    "does not retain the raw recent window when it exceeds the preserve budget",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        for (let index = 0; index < 50; index++) {
          yield* createToolTurn(session.id, test.directory, `heavy-${index}`, "x".repeat(40_000))
        }
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBeUndefined()
        expect(captured).toContain("heavy-0")
        expect(captured).toContain("[Tool output truncated for compaction")
        expect(captured).not.toContain("x".repeat(10_000))

        const filtered = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        expect(filtered.some((msg) => msg.parts.some((part) => part.type === "tool"))).toBe(false)
      }).pipe(withCompaction({ llm: stub.llmLayer, config: cfg({ tail_turns: 2 }) }))
    },
    { git: true },
  )

  itCompaction.instance(
    "shrinks a tool-heavy session in one compaction and stays bounded on repeat",
    () => {
      const stub = llm()
      let first = ""
      let second = ""
      let third = ""
      stub.push(reply("digest-1", (input) => (first = JSON.stringify(input.messages))))
      stub.push(reply("digest-2", (input) => (second = JSON.stringify(input.messages))))
      stub.push(reply("digest-3", (input) => (third = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        for (let index = 0; index < 28; index++) {
          yield* createToolTurn(session.id, test.directory, `turn-${index}`, "y".repeat(80_000))
        }
        const finalOne = yield* createUserMessage(session.id, "final-1")
        yield* createUserMessage(session.id, "final-2")
        yield* createSummaryCompaction(session.id)

        const before = Token.estimate(JSON.stringify(yield* ssn.messages({ sessionID: session.id })))
        let msgs = yield* ssn.messages({ sessionID: session.id })
        let parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBe(finalOne.id)
        expect(first).toContain("turn-0")
        expect(first).toContain("[Tool output truncated for compaction")

        const model = createModel({ context: 100_000, output: 32_000 })
        const filtered = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        const assembled = yield* MessageV2.toModelMessagesEffect(filtered, model)
        const assembledTokens = Token.estimate(JSON.stringify(assembled))
        expect(before).toBeGreaterThan(100_000)
        expect(assembledTokens).toBeLessThanOrEqual(48_000)

        yield* createUserMessage(session.id, "round-2 work")
        yield* createSummaryCompaction(session.id)
        msgs = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part2 = yield* readCompactionPart(session.id)
        expect(part2?.tail_start_id).toBeTruthy()
        expect(second).toContain("<previous-summary>")
        expect(second).toContain("digest-1")
        expect(second).toContain("final-1")
        expect(second).not.toContain("y".repeat(10_000))

        yield* createUserMessage(session.id, "round-3 work")
        yield* createSummaryCompaction(session.id)
        msgs = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part3 = yield* readCompactionPart(session.id)
        expect(part3?.tail_start_id).toBeTruthy()
        expect(third).toContain("<previous-summary>")
        expect(third).toContain("digest-2")
        expect(third).toContain("final-2")
        expect(third).not.toContain("digest-1")

        const filtered3 = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        const assembled3 = yield* MessageV2.toModelMessagesEffect(filtered3, model)
        expect(Token.estimate(JSON.stringify(assembled3))).toBeLessThanOrEqual(48_000)
        expect(filtered3.filter((msg) => msg.info.role === "assistant" && msg.info.summary)).toHaveLength(2)
        expect(JSON.stringify(filtered3)).not.toContain("digest-1")
      }).pipe(withCompaction({ llm: stub.llmLayer, config: cfg({ tail_turns: 2 }) }))
    },
    { git: true },
  )

  itCompaction.instance(
    "keeps the digest bounded when one tool result exceeds the whole preserve budget",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        yield* createToolTurn(session.id, test.directory, "big-result", "z".repeat(400_000))
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBeUndefined()
        expect(captured.length).toBeLessThan(20_000)
        expect(captured).toContain("[Tool output truncated for compaction")
      }).pipe(withCompaction({ llm: stub.llmLayer, config: cfg({ tail_turns: 1, preserve_recent_tokens: 2_000 }) }))
    },
    { git: true },
  )

  itCompaction.instance(
    "keeps mixed light and heavy turns within the budget",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        yield* createToolTurn(session.id, test.directory, "heavy-0", "x".repeat(40_000))
        yield* createUserMessage(session.id, "light-1")
        yield* createToolTurn(session.id, test.directory, "heavy-2", "x".repeat(40_000))
        const keep = yield* createUserMessage(session.id, "keep-me-3")
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBe(keep.id)
        expect(captured).toContain("light-1")
        expect(captured).toContain("[Tool output truncated for compaction")
        expect(captured).not.toContain("keep-me-3")
      }).pipe(withCompaction({ llm: stub.llmLayer, config: cfg({ tail_turns: 2, preserve_recent_tokens: 100 }) }))
    },
    { git: true },
  )

  itCompaction.instance(
    "keeps an exact recent user correction verbatim",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        yield* createToolTurn(session.id, test.directory, "heavy-early", "x".repeat(40_000))
        const note = yield* createUserMessage(session.id, "note-1")
        yield* createUserMessage(session.id, "CORRECTION: always run bun typecheck before committing")
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBe(note.id)
        expect(captured).toContain("heavy-early")
        expect(captured).not.toContain("CORRECTION")

        const filtered = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        const texts = filtered
          .flatMap((msg) => msg.parts.map((part) => (part.type === "text" ? part.text : "")))
          .join("\n")
        expect(texts).toContain("CORRECTION: always run bun typecheck before committing")
        expect(texts).not.toContain("heavy-early")
      }).pipe(withCompaction({ llm: stub.llmLayer }))
    },
    { git: true },
  )

  itCompaction.instance(
    "keeps a recent tool error available for continuation",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        yield* createToolTurn(session.id, test.directory, "heavy-early", "x".repeat(40_000))
        const retry = yield* createUserMessage(session.id, "retry the patch")
        const assistant = yield* createAssistantMessage(session.id, retry.id, test.directory)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "bash",
          state: {
            status: "error",
            input: { command: "git apply" },
            error: "patch application failed: hunk #2 rejected",
            time: { start: Date.now(), end: Date.now() },
          },
        })
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        expect(captured).toContain("heavy-early")
        expect(captured).not.toContain("hunk #2 rejected")

        const filtered = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        const json = JSON.stringify(filtered)
        expect(json).toContain("patch application failed: hunk #2 rejected")
      }).pipe(withCompaction({ llm: stub.llmLayer }))
    },
    { git: true },
  )

  itCompaction.instance(
    "retains a complete user-assistant-tool sequence in the tail",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        yield* createToolTurn(session.id, test.directory, "heavy-early", "x".repeat(40_000))
        const runUser = yield* createUserMessage(session.id, "run the test suite")
        const runAssistant = yield* createAssistantMessage(session.id, runUser.id, test.directory)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: runAssistant.id,
          sessionID: session.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "3 tests passed",
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        expect(captured).toContain("heavy-early")
        expect(captured).not.toContain("run the test suite")

        const filtered = MessageV2.filterCompacted(yield* MessageV2.stream(session.id))
        expect(filtered[2]?.info.role).toBe("user")
        expect(JSON.stringify(filtered[2])).toContain("run the test suite")
        expect(filtered[3]?.info.role).toBe("assistant")
        expect(JSON.stringify(filtered[3])).toContain("3 tests passed")
      }).pipe(withCompaction({ llm: stub.llmLayer }))
    },
    { git: true },
  )

  itCompaction.instance(
    "bounds the tail on a small-context model",
    () => {
      const stub = llm()
      stub.push(reply("digest"))
      return Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        const users: SessionV1.User[] = []
        for (let index = 0; index < 10; index++) {
          users.push(yield* createUserMessage(session.id, "m".repeat(3_600)))
        }
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBe(users[3]!.id)
        expect(
          yield* estimateTailTokens(session.id, part!.tail_start_id!, createModel({ context: 32_000, output: 4_000 })),
        ).toBeLessThanOrEqual(7_000)
      }).pipe(
        withCompaction({
          llm: stub.llmLayer,
          config: cfg({ tail_turns: 10 }),
          provider: ProviderTest.fake({ model: createModel({ context: 32_000, output: 4_000 }) }),
        }),
      )
    },
    { git: true },
  )

  itCompaction.instance(
    "keeps the default tail bound on a large-context model",
    () => {
      const stub = llm()
      stub.push(reply("digest"))
      return Effect.gen(function* () {
        const test = yield* TestInstance
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        const users: SessionV1.User[] = []
        for (let index = 0; index < 12; index++) {
          const turn = yield* createToolTurn(session.id, test.directory, `turn-${index}`, "w".repeat(10_000))
          users.push(turn.user)
        }
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBe(users[9]!.id)
        expect(
          yield* estimateTailTokens(
            session.id,
            part!.tail_start_id!,
            createModel({ context: 1_000_000, output: 64_000, input: 900_000 }),
          ),
        ).toBeLessThanOrEqual(8_000)
      }).pipe(
        withCompaction({
          llm: stub.llmLayer,
          config: cfg({ tail_turns: 12 }),
          provider: ProviderTest.fake({ model: createModel({ context: 1_000_000, output: 64_000, input: 900_000 }) }),
        }),
      )
    },
    { git: true },
  )

  itCompaction.instance(
    "digests everything when tail_turns is zero",
    () => {
      const stub = llm()
      let captured = ""
      stub.push(reply("digest", (input) => (captured = JSON.stringify(input.messages))))
      return Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        yield* createUserMessage(session.id, "earliest")
        yield* createUserMessage(session.id, "latest")
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBeUndefined()
        expect(captured).toContain("latest")
      }).pipe(withCompaction({ llm: stub.llmLayer, config: cfg({ tail_turns: 0 }) }))
    },
    { git: true },
  )

  itCompaction.instance(
    "keeps four turns when tail_turns is raised",
    () => {
      const stub = llm()
      stub.push(reply("digest"))
      return Effect.gen(function* () {
        const ssn = yield* SessionNs.Service
        const session = yield* ssn.create({})
        const users: SessionV1.User[] = []
        for (let index = 0; index < 6; index++) {
          users.push(yield* createUserMessage(session.id, `turn-${index}`))
        }
        yield* createSummaryCompaction(session.id)

        const msgs = yield* ssn.messages({ sessionID: session.id })
        const parent = msgs.at(-1)?.info.id
        expect(parent).toBeTruthy()
        yield* SessionCompaction.use.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false })

        const part = yield* readCompactionPart(session.id)
        expect(part?.tail_start_id).toBe(users[2]!.id)
      }).pipe(withCompaction({ llm: stub.llmLayer, config: cfg({ tail_turns: 4 }) }))
    },
    { git: true },
  )
})
