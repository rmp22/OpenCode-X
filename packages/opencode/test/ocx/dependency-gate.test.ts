import { describe, expect, test } from "bun:test"
import { DependencyGate } from "../../src/ocx/dependency-gate"

describe("dependency gate", () => {
  test("flags a new package absent from a valid manifest", () => {
    const findings = DependencyGate.dependencyFindings(
      new Map([["src/app.ts", ['import { x } from "not-installed"', 'import { z } from "zod"']]]),
      JSON.stringify({ dependencies: { zod: "1.0.0" } }),
    )
    expect(findings).toEqual([
      {
        id: "C26-unlisted-dependency",
        message: 'added import "not-installed" is absent from the project manifest; verify the package before importing it',
        span: "src/app.ts: not-installed",
      },
    ])
  })

  test("ignores local, alias, built-in, and listed imports", () => {
    const findings = DependencyGate.dependencyFindings(
      new Map([
        ["src/app.ts", ['import "./local"', 'import "@/config"', 'import "node:fs"', 'import "fs"', 'import "zod"']],
      ]),
      JSON.stringify({ dependencies: { zod: "1.0.0" } }),
    )
    expect(findings).toEqual([])
  })

  test("reports malformed manifest text instead of passing silently", () => {
    const findings = DependencyGate.dependencyFindings(new Map([["src/app.ts", ['import "new-package"']]]), "{")
    expect(findings).toEqual([
      {
        id: "C25-invalid-manifest",
        message: "package manifest could not be parsed; verify dependencies before importing new packages",
      },
    ])
  })

  test("caps findings for a noisy import list", () => {
    const lines = Array.from({ length: 5 }, (_, index) => `import "missing-${index}"`)
    const findings = DependencyGate.dependencyFindings(new Map([["src/app.ts", lines]]), JSON.stringify({}))
    expect(findings).toHaveLength(3)
  })
})
