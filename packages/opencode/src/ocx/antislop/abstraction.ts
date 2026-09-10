export type AbstractionSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

const SUSPICIOUS_ABSTRACTIONS = new Set([
  "Manager", "Helper", "Utils", "Service", "Factory", "Provider",
  "Coordinator", "Handler", "Context", "Strategy", "Adapter", "Wrapper",
])

export function scanAbstraction(content: string, filePath: string): readonly AbstractionSlopFinding[] {
  const findings: AbstractionSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    for (const name of SUSPICIOUS_ABSTRACTIONS) {
      if (trimmed.includes(`class ${name}`) || trimmed.includes(`interface ${name}`) || trimmed.includes(`type ${name}`)) {
        findings.push({
          rule: "AB-suspicious-abstraction",
          severity: "warning",
          evidence: `${name} abstraction at line ${i + 1}`,
          fix: "ensure it has a clear responsibility, real need, and net complexity reduction",
        })
      }
    }
  }

  return findings
}

export * as AbstractionSlop from "./abstraction"