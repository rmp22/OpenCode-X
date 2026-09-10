import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative } from "node:path"
import { ADRStore, type ADRInput } from "../../src/ocx/adr-store"

const plan: ADRInput = {
  operation: "add",
  goal: "record decisions",
  scope: "Keep the structure plan outside the workspace.",
  allowedChanges: ["Add the append-only record."],
  allowedBreaks: [],
  nonGoals: ["Change the workspace."],
  acceptanceChecks: ["Read the record back."],
  rollbackPlan: "Remove the optional records.",
  files: [
    {
      path: "src/adr-store.ts",
      owns: "ADR persistence",
      doesNotOwn: "Tool validation",
      importsOrUses: ["node:fs"],
      publicInputsOrOutputs: ["append"],
    },
  ],
  dependencyDirection: "The tool depends on the store.",
  stateOwner: "The store owns ADR files.",
  preservedContracts: ["Structure parameters remain unchanged."],
}

describe("ADRStore", () => {
  test("writes four-digit monotonic records and supersedes without editing the prior record", () => {
    const root = mkdtempSync(join(tmpdir(), "ocx-adr-"))
    try {
      const first = ADRStore.append(root, "session/../../unsafe", plan)
      const firstBefore = readFileSync(first, "utf8")
      const second = ADRStore.append(root, "session/../../unsafe", plan)
      const firstName = basename(first)
      const secondName = basename(second)
      expect(firstName).toMatch(/^0001-.+\.md$/)
      expect(secondName).toMatch(/^0002-.+\.md$/)
      expect(readFileSync(first, "utf8")).toBe(firstBefore)
      expect(readFileSync(second, "utf8")).toContain(`Supersedes: ${firstName}`)
      expect(readdirSync(join(root, "ocx", "adr"))).toHaveLength(1)
      expect(first).toContain(join(root, "ocx", "adr"))
      expect(relative(join(root, "ocx", "adr"), first).split("/")).toHaveLength(2)
      expect(relative(join(root, "ocx", "adr"), first)).not.toContain("..")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("keeps session-derived directories inside the supplied data root", () => {
    const root = mkdtempSync(join(tmpdir(), "ocx-adr-root-"))
    try {
      const record = ADRStore.append(root, "../../outside", plan)
      const adrRoot = join(root, "ocx", "adr")
      expect(record.startsWith(`${adrRoot}/`)).toBe(true)
      expect(relative(adrRoot, record).split("/")).toHaveLength(2)
      expect(relative(adrRoot, record)).not.toContain("..")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
