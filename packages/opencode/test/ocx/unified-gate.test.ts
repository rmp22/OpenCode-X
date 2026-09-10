import { describe, expect, test } from "bun:test"
import { ScopePermit } from "../../src/ocx/scope-permit"
import { UnifiedGate } from "../../src/ocx/unified-gate"
import { RetryBudget } from "../../src/ocx/retry-budget"

const CWD = "/workspace/project-tests"
const ROOT = `${CWD}/thinkingmachines-inkling-free-max/web-design`

function discover() {
  return {
    workflow: "design",
    phase: "discover",
    phases: [{ id: "discover" }, { id: "implement" }],
  }
}

function permit() {
  return ScopePermit.mintFromDirectives(
    ["Work only inside: thinkingmachines-inkling-free-max/web-design/", "Download required resources."],
    CWD,
  )!
}

describe("unified-gate session replay (ses_f953)", () => {
  test("mkdir inside the ordered scope is allowed during discover", () => {
    const decision = UnifiedGate.authorize(
      { effects: ["FILESYSTEM_WRITE"], paths: [`${ROOT}/assets/images`], cwd: CWD },
      discover(),
      permit(),
    )
    expect(decision.allowed).toBe(true)
  })

  test("curl download into scope is allowed during discover", () => {
    const decision = UnifiedGate.authorize(
      { effects: ["FILESYSTEM_WRITE", "NETWORK_READ"], paths: [`${ROOT}/assets/images/hero-house.jpg`], cwd: CWD },
      discover(),
      permit(),
    )
    expect(decision.allowed).toBe(true)
  })

  test("redirect to /tmp is allowed without any permit", () => {
    const decision = UnifiedGate.authorize(
      { effects: ["FILESYSTEM_WRITE"], paths: ["/tmp/http_server.log"], cwd: CWD },
      discover(),
      undefined,
    )
    expect(decision.allowed).toBe(true)
  })

  test("screenshot to /tmp is allowed without any permit", () => {
    const decision = UnifiedGate.authorize(
      { effects: ["FILESYSTEM_WRITE"], paths: ["/tmp/screenshot_hero.png"], cwd: CWD },
      discover(),
      undefined,
    )
    expect(decision.allowed).toBe(true)
  })

  test("writes outside the scope stay denied", () => {
    const decision = UnifiedGate.authorize(
      { effects: ["FILESYSTEM_WRITE"], paths: ["/etc/ocx-evil"], cwd: CWD },
      discover(),
      permit(),
    )
    expect(decision.allowed).toBe(false)
  })
})

describe("retry-budget", () => {
  test("sanctioned retries are exempt from repeat escalation", () => {
    const store = new Map<string, number>()
    const first = RetryBudget.record(store, { capability: "command.run", phase: "discover", code: "WORKFLOW_BYPASS_BLOCKED" })
    expect(first.repeated).toBe(false)
    const sanctioned = RetryBudget.record(store, {
      capability: "command.run",
      phase: "discover",
      code: "WORKFLOW_BYPASS_BLOCKED",
    })
    expect(sanctioned.repeated).toBe(true)
    expect(RetryBudget.isSanctionedRetry("write /scope/index.html", "write /scope/index.html")).toBe(true)
    expect(RetryBudget.isSanctionedRetry("rm -rf /", "write /scope/index.html")).toBe(false)
  })
})
