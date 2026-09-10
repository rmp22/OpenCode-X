import { describe, expect, test } from "bun:test"
import { Phases } from "../../src/ocx/phases"

const toolset = () => ({
  read: { id: "read" },
  grep: { id: "grep" },
  glob: { id: "glob" },
  ocx_header: { id: "ocx_header" },
  ocx_playbook: { id: "ocx_playbook" },
  todowrite: { id: "todowrite" },
  edit: { id: "edit" },
  write: { id: "write" },
  multiedit: { id: "multiedit" },
  apply_patch: { id: "apply_patch" },
  bash: { id: "bash" },
  task: { id: "task" },
})

describe("contract phase gate", () => {
  test("mutation tools are removed while the contract is open", () => {
    const gated = Phases.applyPhaseGate(toolset(), { gated: true })
    const names = Object.keys(gated)
    for (const blocked of ["edit", "write", "multiedit", "apply_patch", "task"]) expect(names).not.toContain(blocked)
    for (const kept of ["read", "grep", "glob", "ocx_header", "ocx_playbook", "todowrite", "bash"])
      expect(names).toContain(kept)
  })

  test("ungated passes everything through untouched", () => {
    const tools = toolset()
    const out = Phases.applyPhaseGate(tools, { gated: false })
    expect(Object.keys(out).length).toBe(Object.keys(tools).length)
    expect(out).toBe(tools)
  })

  test("case-insensitive tool matching", () => {
    const tools = { Edit: { id: "Edit" }, BASH: { id: "BASH" }, read: { id: "read" } }
    const out = Phases.applyPhaseGate(tools, { gated: true })
    expect(Object.keys(out)).toEqual(["BASH", "read"])
  })

  test("isMutationTool covers the escape-hatch check", () => {
    expect(Phases.isMutationTool("Write")).toBe(true)
    expect(Phases.isMutationTool("bash")).toBe(false)
    expect(Phases.isMutationTool("read")).toBe(false)
  })

  test("agentic phase capability filtering", () => {
    expect(Phases.isAgenticPhase("orient")).toBe(true)
    expect(Phases.isAgenticPhase("mutate")).toBe(true)
    expect(Phases.isAgenticPhase("signoff")).toBe(true)
    expect(Phases.isAgenticPhase("unknown_phase")).toBe(false)

    const tools = toolset()
    const orientTools = Phases.filterToolsForCapability(tools, "orient")
    expect(Object.keys(orientTools)).not.toContain("edit")
    expect(Object.keys(orientTools)).not.toContain("write")
    expect(Object.keys(orientTools)).toContain("read")

    const mutateTools = Phases.filterToolsForCapability(tools, "mutate")
    expect(Object.keys(mutateTools)).toContain("edit")
    expect(Object.keys(mutateTools)).toContain("write")

    const customTools = Phases.filterToolsForCapability(tools, "orient", { allowedTools: ["read", "grep"] })
    expect(Object.keys(customTools)).toEqual(["read", "grep"])
  })
})
