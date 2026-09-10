/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import type { GlobalEvent, ToolPart } from "@opencode-ai/sdk/v2"
import { mkdir } from "node:fs/promises"
import { onCleanup, onMount } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createEventSource, createFetch, directory } from "../fixture/tui-sdk"
import { OcxTool, SessionContext } from "../../src/routes/session"

const sessionID = "ses_ocx_tool_test"

async function mountOcxTool(toolProps: {
  tool: string
  input: Record<string, unknown>
  status: "pending" | "running" | "completed" | "error"
}) {
  await using tmp = await tmpdir()
  const state = `${tmp.path}/state`
  await mkdir(state, { recursive: true })
  await Bun.write(`${state}/kv.json`, "{}")
  const calls = createFetch()
  const events = createEventSource()
  const [
    { SyncProvider, useSync },
    { ThemeProvider },
    { TuiConfigProvider },
    { ArgsProvider },
    { KVProvider },
    { SDKProvider },
    { PermissionProvider },
    { ProjectProvider },
    { ExitProvider },
    { createTuiResolvedConfig },
  ] = await Promise.all([
    import("../../src/context/sync"),
    import("../../src/context/theme"),
    import("../../src/config"),
    import("../../src/context/args"),
    import("../../src/context/kv"),
    import("../../src/context/sdk"),
    import("../../src/context/permission"),
    import("../../src/context/project"),
    import("../../src/context/exit"),
    import("../fixture/tui-runtime"),
  ])

  let ready!: () => void
  const done = new Promise<void>((resolve) => {
    ready = resolve
  })
  let sync!: ReturnType<typeof useSync>

  function Probe() {
    const context = useSync()
    onMount(() => {
      sync = context
      const timer = setInterval(() => {
        if (sync.status !== "complete") return
        clearInterval(timer)
        ready()
      }, 10)
      onCleanup(() => clearInterval(timer))
    })
    return <box />
  }

  const toolState =
    toolProps.status === "running"
      ? {
          status: "running" as const,
          input: toolProps.input,
          time: { start: 1 },
        }
      : toolProps.status === "completed"
        ? {
            status: "completed" as const,
            input: toolProps.input,
            output: "",
            title: "Plan",
            metadata: {},
            time: { start: 1, end: 2 },
          }
        : toolProps.status === "error"
          ? {
              status: "error" as const,
              input: toolProps.input,
              error: "Execution failed",
              time: { start: 1, end: 2 },
            }
          : {
              status: "pending" as const,
              input: toolProps.input,
              raw: "",
            }

  const part: ToolPart = {
    id: "prt_1",
    messageID: "msg_1",
    sessionID,
    type: "tool",
    tool: toolProps.tool,
    callID: "call_1",
    state: toolState,
  }

  function ToolWrapper() {
    const syncContext = useSync()
    const tuiConfig = createTuiResolvedConfig({})
    return (
      <SessionContext.Provider
        value={{
          width: 80,
          sessionID,
          conceal: () => false,
          thinkingMode: () => "hide" as const,
          showThinking: () => false,
          showTimestamps: () => false,
          showDetails: () => false,
          showGenericToolOutput: () => false,
          diffWrapMode: () => "none" as const,
          providers: () => new Map(),
          sync: syncContext,
          tui: tuiConfig,
        }}
      >
        <Probe />
        <OcxTool
          tool={toolProps.tool}
          input={toolProps.input}
          metadata={{}}
          part={part}
        />
      </SessionContext.Provider>
    )
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={{ home: tmp.path, state, worktree: tmp.path }}>
      <ArgsProvider>
        <TuiConfigProvider config={createTuiResolvedConfig({})}>
          <KVProvider>
            <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
              <PermissionProvider>
                <ProjectProvider>
                  <ExitProvider exit={() => {}}>
                    <ThemeProvider mode="dark">
                      <SyncProvider>
                        <ToolWrapper />
                      </SyncProvider>
                    </ThemeProvider>
                  </ExitProvider>
                </ProjectProvider>
              </PermissionProvider>
            </SDKProvider>
          </KVProvider>
        </TuiConfigProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))

  await done
  return { app }
}

async function frame(app: Awaited<ReturnType<typeof mountOcxTool>>["app"]) {
  await app.renderOnce()
  await app.renderOnce()
  return app.captureCharFrame()
}

describe("OcxTool component", () => {
  test("renders running ocx_plan with items without TextNodeRenderable crash", async () => {
    const { app } = await mountOcxTool({
      tool: "ocx_plan",
      input: {
        summary: "Refactor session state",
        steps: [
          { content: "Step 1", status: "completed" },
          { content: "Step 2", status: "in_progress" },
        ],
      },
      status: "running",
    })

    const text = await frame(app)
    expect(text).toContain("Plan: Refactor session state")
    expect(text).toContain("Step 1")
    expect(text).toContain("Step 2")
    app.renderer.destroy()
  })

  test("renders completed ocx_plan with items without crash", async () => {
    const { app } = await mountOcxTool({
      tool: "ocx_plan",
      input: {
        summary: "Refactor session state",
        steps: [
          { content: "Step 1", status: "completed" },
          { content: "Step 2", status: "completed" },
        ],
      },
      status: "completed",
    })

    const text = await frame(app)
    expect(text).toContain("Plan: Refactor session state")
    expect(text).toContain("Step 1")
    expect(text).toContain("Step 2")
    app.renderer.destroy()
  })

  test("renders other ocx tools like ocx_context without crash", async () => {
    const { app } = await mountOcxTool({
      tool: "ocx_context",
      input: { operation: "explore", query: "auth token" },
      status: "running",
    })

    const text = await frame(app)
    expect(text).toContain('Context: Explore "auth token"')
    app.renderer.destroy()
  })
})
