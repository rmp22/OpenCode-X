/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { PermissionProvider, usePermission } from "../../src/context/permission"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"

async function wait(fn: () => boolean | Promise<boolean>, timeout = 2000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function readPersisted(state: string): Promise<unknown> {
  try {
    const file = Bun.file(path.join(state, "kv.json"))
    return (await file.json())["permission_auto"]
  } catch {
    return undefined
  }
}

async function mountPermission(input: { root: string; state: string; auto?: boolean }) {
  await mkdir(input.state, { recursive: true })
  let permission: ReturnType<typeof usePermission> | undefined

  function Capture() {
    permission = usePermission()
    return <text>{`mode:${permission.mode}`}</text>
  }

  const app = await testRender(() => (
    <TestTuiContexts
      directory={input.root}
      paths={{ home: input.root, state: input.state, worktree: input.root }}
    >
      <ArgsProvider auto={input.auto}>
        <KVProvider>
          <PermissionProvider>
            <Capture />
          </PermissionProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))

  function requirePermission() {
    if (!permission) throw new Error("Permission context did not mount")
    return permission
  }

  return {
    app,
    mode: () => permission?.mode,
    toggle: () => requirePermission().toggle(),
    cleanup() {
      app.renderer.destroy()
    },
  }
}

test("toggle persists the permission mode across sessions", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")

  const first = await mountPermission({ root: tmp.path, state })
  try {
    await wait(() => first.mode() === "normal")
    first.toggle()
    await wait(() => first.mode() === "auto")
    await wait(async () => (await readPersisted(state)) === true)
  } finally {
    first.cleanup()
  }

  const second = await mountPermission({ root: tmp.path, state })
  try {
    await wait(() => second.mode() === "auto")
    expect(await readPersisted(state)).toBe(true)

    second.toggle()
    await wait(() => second.mode() === "normal")
    await wait(async () => (await readPersisted(state)) === false)
  } finally {
    second.cleanup()
  }
})

test("an explicit auto launch flag wins over the persisted choice", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), JSON.stringify({ permission_auto: false }))

  const session = await mountPermission({ root: tmp.path, state, auto: true })
  try {
    await wait(() => session.mode() !== undefined)
    expect(session.mode()).toBe("auto")
  } finally {
    session.cleanup()
  }
})
