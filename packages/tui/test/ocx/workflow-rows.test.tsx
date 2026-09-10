/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { mkdir } from "node:fs/promises"
import { onCleanup, onMount } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createEventSource, createFetch, directory } from "../fixture/tui-sdk"

const sessionID = "ses_ocx_test"

function ocxEvent(type: string, properties: Record<string, unknown>): GlobalEvent {
  return {
    directory,
    project: "proj_test",
    payload: {
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type,
      properties,
    },
  } as unknown as GlobalEvent
}

function activity(overrides: Record<string, unknown> = {}) {
  return {
    sessionID,
    activityID: "act_1",
    ownerType: "assistant",
    ownerID: "assistant-1",
    kind: "thinking",
    state: "active",
    title: "Thinking",
    updatedAt: 10,
    seq: 10,
    ...overrides,
  }
}

async function mountRows() {
  await using tmp = await tmpdir()
  const state = `${tmp.path}/state`
  await mkdir(state, { recursive: true })
  await Bun.write(`${state}/kv.json`, "{}")
  const calls = createFetch()
  const events = createEventSource()
  const [{ SyncProvider, useSync }, { ThemeProvider }, { TuiConfigProvider }, { ArgsProvider }, { KVProvider }, { SDKProvider }, { PermissionProvider }, { ProjectProvider }, { ExitProvider }, { createTuiResolvedConfig }] = await Promise.all([
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
  const { OcxMilestones } = await import("../../src/ocx/workflow-rows")
  const { PrimaryActivityRow } = await import("../../src/ocx/activity-row")

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

  function Rows() {
    const context = useSync()
    return (
      <>
        <Probe />
        <PrimaryActivityRow sessionID={sessionID} />
        <OcxMilestones sessionID={sessionID} entries={context.data.session_ocx_log[sessionID] ?? []} />
      </>
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
                        <Rows />
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
  return { app, emit: events.emit, sync }
}

async function frame(app: Awaited<ReturnType<typeof mountRows>>["app"]) {
  await app.renderOnce()
  await app.renderOnce()
  return app.captureCharFrame()
}

async function waitFor(fn: () => boolean, timeout = 2_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

describe("canonical OCX activity rows", () => {
  test("renders the canonical active activity and clears on none", async () => {
    const { app, emit, sync } = await mountRows()
    try {
      emit(ocxEvent("session.status", { sessionID, status: { type: "busy" } }))
      emit(ocxEvent("ocx.activity", activity({ detail: "Checking the current page" })))
      await waitFor(() => sync.data.session_activity[sessionID]?.seq === 10)
      const active = await frame(app)
      expect(active).toContain("Thinking")
      expect(active).toContain("Checking the current page")

      emit(ocxEvent("ocx.activity", activity({ seq: 9, state: "failed", updatedAt: 9, detail: "old failure" })))
      await Bun.sleep(20)
      expect(sync.data.session_activity[sessionID]?.detail).toBe("Checking the current page")

      emit(ocxEvent("ocx.activity", activity({ seq: 11, state: "none", activityID: "act_1", ownerID: "act_1", detail: undefined })))
      await waitFor(() => sync.data.session_activity[sessionID] === undefined)
      expect(await frame(app)).not.toContain("Checking the current page")
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not let an old activity identity clear a newer activity", async () => {
    const { app, emit, sync } = await mountRows()
    try {
      emit(ocxEvent("ocx.activity", activity({ seq: 20, activityID: "new", ownerID: "new", title: "New work" })))
      await waitFor(() => sync.data.session_activity[sessionID]?.activityID === "new")
      emit(ocxEvent("ocx.activity", activity({ seq: 21, state: "none", activityID: "old", ownerID: "old" })))
      await Bun.sleep(20)
      expect(sync.data.session_activity[sessionID]?.activityID).toBe("new")
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders terminal activity as a static milestone", async () => {
    const { app, emit, sync } = await mountRows()
    try {
      emit(
        ocxEvent("ocx.activity", activity({
          seq: 30,
          activityID: "pass-1",
          ownerType: "playbook",
          ownerID: "pass-1",
          kind: "playbook",
          state: "failed",
          title: "Playbook 1/2 - UI",
          detail: "browser check failed",
          updatedAt: 30,
        })),
      )
      await waitFor(() => (sync.data.session_ocx_log[sessionID]?.length ?? 0) > 0)
      const rendered = await frame(app)
      expect(rendered).toContain("! browser check failed")
      expect(rendered).not.toContain("Playbook 1/2 - UI")
    } finally {
      app.renderer.destroy()
    }
  })

  test("idle hides a stale active projection", async () => {
    const { app, emit, sync } = await mountRows()
    try {
      emit(ocxEvent("ocx.activity", activity({ seq: 40, detail: "stale work" })))
      await waitFor(() => sync.data.session_activity[sessionID]?.seq === 40)
      emit(ocxEvent("session.status", { sessionID, status: { type: "idle" } }))
      await waitFor(() => sync.data.session_status[sessionID]?.type === "idle")
      expect(await frame(app)).not.toContain("stale work")
    } finally {
      app.renderer.destroy()
    }
  })

  test("legacy stage events do not create a second primary spinner", async () => {
    const { app, emit } = await mountRows()
    try {
      emit(ocxEvent("session.status", { sessionID, status: { type: "busy" } }))
      emit(ocxEvent("ocx.activity", { sessionID, stage: "thinking", active: true, summary: "legacy" }))
      await Bun.sleep(20)
      expect(await frame(app)).not.toContain("legacy")
    } finally {
      app.renderer.destroy()
    }
  })
})
