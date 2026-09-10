import { describe, expect, test } from "bun:test"
import { classifyTool, isKnownTool, PolicyEngine, isProtectedPath, isDestructiveCommand } from "@/ocx/policy"
import { isToolAllowed } from "@/ocx/graph/capabilities"
import { apply as applyGate } from "@/ocx/turn/gate"

describe("PolicyEngine and Unified Authority", () => {
  test("tools are classified correctly", () => {
    const tools = [
      "read",
      "glob",
      "grep",
      "write",
      "edit",
      "bash",
      "todowrite",
      "question",
      "task",
      "websearch",
      "webfetch",
      "ocx_header",
      "ocx_plan",
    ]

    for (const t of tools) {
      expect(isKnownTool(t)).toBe(true)
    }

    expect(classifyTool("read")).toBe("read")
    expect(classifyTool("write")).toBe("mutate")
    expect(classifyTool("edit")).toBe("mutate")
    expect(classifyTool("bash")).toBe("execute")
    expect(classifyTool("webfetch")).toBe("external")
    expect(classifyTool("todowrite")).toBe("administrative")
  })

  test("phase cannot affect operation verdict", () => {
    const writeInPlan = PolicyEngine.evaluate("write", { phase: "plan" })
    expect(writeInPlan.allowed).toBe(true)
    expect(writeInPlan.category).toBe("mutate")

    const bashInPlan = PolicyEngine.evaluate("bash", { phase: "plan" })
    expect(bashInPlan.allowed).toBe(true)
    expect(bashInPlan.category).toBe("execute")

    const readInPlan = PolicyEngine.evaluate("read", { phase: "plan" })
    expect(readInPlan.allowed).toBe(true)
    expect(readInPlan.category).toBe("read")

    const writeInExec = PolicyEngine.evaluate("write", { phase: "change" })
    expect(writeInExec.allowed).toBe(true)

    const bashInExec = PolicyEngine.evaluate("bash", { phase: "change" })
    expect(bashInExec.allowed).toBe(true)

    const writeInVerify = PolicyEngine.evaluate("write", { phase: "verify" })
    expect(writeInVerify.allowed).toBe(true)

    const bashInVerify = PolicyEngine.evaluate("bash", { phase: "verify" })
    expect(bashInVerify.allowed).toBe(true)
  })

  test("security protections enforce protected paths and destructive commands", () => {
    expect(isProtectedPath(".git/config")).toBe(true)
    expect(isProtectedPath(".env")).toBe(true)
    expect(isProtectedPath("id_rsa")).toBe(true)
    expect(isProtectedPath("src/index.ts")).toBe(false)

    expect(isDestructiveCommand("rm -rf /")).toBe(true)
    expect(isDestructiveCommand("git reset --hard")).toBe(true)
    expect(isDestructiveCommand("git push --force")).toBe(true)
    expect(isDestructiveCommand("git status")).toBe(false)

    const protectedWrite = PolicyEngine.evaluate("write", { path: ".git/HEAD" })
    expect(protectedWrite.allowed).toBe(false)
    expect(protectedWrite.reason).toContain("protected path")

    const destructiveBash = PolicyEngine.evaluate("bash", { command: "rm -rf /" })
    expect(destructiveBash.allowed).toBe(false)
    expect(destructiveBash.reason).toContain("Destructive command")
  })

  test("node capabilities govern tool authorization including empty and wildcard", () => {
    const emptyAllowed = isToolAllowed({ allowedTools: [] }, "read")
    expect(emptyAllowed.allowed).toBe(false)

    const wildcardAllowed = isToolAllowed({ allowedTools: ["*"] }, "read")
    expect(wildcardAllowed.allowed).toBe(true)

    const explicitlyAllowed = isToolAllowed({ allowedTools: ["read", "write"] }, "read")
    expect(explicitlyAllowed.allowed).toBe(true)

    const explicitlyNotAllowed = isToolAllowed({ allowedTools: ["read"] }, "write")
    expect(explicitlyNotAllowed.allowed).toBe(false)

    const denied = isToolAllowed({ deniedTools: ["bash"] }, "bash")
    expect(denied.allowed).toBe(false)
  })

  test("policy engine handles unknown tools safely when configured", () => {
    const unknown = PolicyEngine.evaluate("unknown_custom_tool", {
      phase: "change",
      allowUnknownTools: false,
    })
    expect(unknown.allowed).toBe(false)
    expect(unknown.reason).toContain("unrecognized")
  })

  test("turn gate integrates node capabilities and does not restrict by phase", () => {
    const mockToolsNodeRestricted: Record<string, any> = {
      read: { description: "read" },
      write: { description: "write" },
      edit: { description: "edit" },
      bash: { description: "bash" },
      todowrite: { description: "todowrite" },
    }

    applyGate(false, 1, mockToolsNodeRestricted, {
      node: { allowedTools: ["read", "todowrite"] },
    })

    expect(mockToolsNodeRestricted.read).toBeDefined()
    expect(mockToolsNodeRestricted.todowrite).toBeDefined()
    expect(mockToolsNodeRestricted.write).toBeUndefined()
    expect(mockToolsNodeRestricted.edit).toBeUndefined()
    expect(mockToolsNodeRestricted.bash).toBeUndefined()

    const mockToolsPhaseOnly: Record<string, any> = {
      read: { description: "read" },
      write: { description: "write" },
      bash: { description: "bash" },
    }

    applyGate(false, 1, mockToolsPhaseOnly, { phase: "plan" })
    expect(mockToolsPhaseOnly.read).toBeDefined()
    expect(mockToolsPhaseOnly.write).toBeDefined()
    expect(mockToolsPhaseOnly.bash).toBeDefined()
  })
})
