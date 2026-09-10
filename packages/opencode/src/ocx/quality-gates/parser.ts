export * as ParserGate from "./parser"

export type ParserFinding = {
  readonly id: string
  readonly message: string
  readonly line: number
  readonly column: number
  readonly severity: "error" | "warning"
}

export function checkSyntax(path: string, content: string): readonly ParserFinding[] {
  const findings: ParserFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    const templateMatches = line.match(/`/g)
    if (templateMatches && templateMatches.length % 2 !== 0) {
      findings.push({
        id: "P1-unclosed-template",
        message: "unclosed template literal; missing closing backtick",
        line: lineNum,
        column: line.length,
        severity: "error",
      })
    }

    const singleQuoteMatches = line.match(/'/g)
    if (singleQuoteMatches && singleQuoteMatches.length % 2 !== 0 && !line.trim().startsWith("//")) {
      findings.push({
        id: "P2-unclosed-string",
        message: "unclosed string literal; missing closing single quote",
        line: lineNum,
        column: line.length,
        severity: "error",
      })
    }

    const doubleQuoteMatches = line.match(/"/g)
    if (doubleQuoteMatches && doubleQuoteMatches.length % 2 !== 0 && !line.trim().startsWith("//")) {
      findings.push({
        id: "P3-unclosed-string",
        message: "unclosed string literal; missing closing double quote",
        line: lineNum,
        column: line.length,
        severity: "error",
      })
    }
  }

  return findings
}

export * as Parser from "./parser"