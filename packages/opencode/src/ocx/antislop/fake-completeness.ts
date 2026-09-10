export type FakeCompletenessFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanFakeCompleteness(content: string, filePath: string): readonly FakeCompletenessFinding[] {
  const findings: FakeCompletenessFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.includes("TODO") || trimmed.includes("FIXME") || trimmed.includes("HACK") || trimmed.includes("XXX")) {
      findings.push({
        rule: "F-todo-in-production",
        severity: "blocker",
        evidence: `TODO/FIXME/HACK/XXX marker at line ${i + 1}`,
        fix: "implement the required behavior or remove the marker",
      })
    }

    if (trimmed.match(/return\s+(?:null|undefined|{}|\[\])\s*;?\s*$/) && trimmed.includes("catch")) {
      findings.push({
        rule: "F-stub-return",
        severity: "warning",
        evidence: `stub return at line ${i + 1}`,
        fix: "implement real behavior instead of returning a placeholder",
      })
    }

    if (trimmed.includes("sample") || trimmed.includes("placeholder") || trimmed.includes("fake") || trimmed.includes("mock")) {
      if (trimmed.includes("return") || trimmed.includes("=")) {
        findings.push({
          rule: "F-placeholder-data",
          severity: "warning",
          evidence: `placeholder/sample/fake data at line ${i + 1}`,
          fix: "use real data or wire up the actual data source",
        })
      }
    }

    if (trimmed.includes("not implemented") || trimmed.includes("TODO: implement")) {
      findings.push({
        rule: "F-unimplemented",
        severity: "blocker",
        evidence: `unimplemented code at line ${i + 1}`,
        fix: "implement the required functionality",
      })
    }
  }

  return findings
}

export * as FakeCompleteness from "./fake-completeness"