export * as FormatGate from "./format"

export type FormatFinding = {
  readonly id: string
  readonly message: string
  readonly line: number
  readonly severity: "error" | "warning" | "info"
}

export function checkFormat(path: string, content: string): readonly FormatFinding[] {
  const findings: FormatFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    if (/\.(ts|tsx|js|jsx|mjs)$/.test(path) && line.includes("\t")) {
      findings.push({
        id: "F1-tabs-instead-of-spaces",
        message: "use spaces instead of tabs for indentation",
        line: lineNum,
        severity: "warning",
      })
    }
  }

  return findings
}

export * as Format from "./format"