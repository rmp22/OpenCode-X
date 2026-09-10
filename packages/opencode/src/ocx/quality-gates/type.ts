export * as TypeGate from "./type"

export type TypeFinding = {
  readonly id: string
  readonly message: string
  readonly line: number
  readonly severity: "error" | "warning" | "info"
}

export function checkTypes(path: string, content: string): readonly TypeFinding[] {
  const findings: TypeFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const trimmed = line.trim()

    if (/\bany\b/.test(trimmed) && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
      findings.push({
        id: "T1-any-type",
        message: "avoid `any` type; use `unknown` with type guards instead",
        line: lineNum,
        severity: "warning",
      })
    }

    if (/^export\s+(?:async\s+)?function\s+\w+/.test(trimmed) && !trimmed.includes(": ")) {
      findings.push({
        id: "T2-missing-return-type",
        message: "exported function should have an explicit return type",
        line: lineNum,
        severity: "info",
      })
    }
  }

  return findings
}

export * as Type from "./type"