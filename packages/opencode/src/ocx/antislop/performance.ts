export type PerformanceSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanPerformanceSlop(content: string, filePath: string): readonly PerformanceSlopFinding[] {
  const findings: PerformanceSlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.includes("for (") && trimmed.includes(";;")) {
      findings.push({
        rule: "P-unbounded-loop",
        severity: "blocker",
        evidence: `unbounded loop at line ${i + 1}`,
        fix: "add a termination condition or use a bounded iteration",
      })
    }

    if (trimmed.includes(".map(") && trimmed.includes(".map(")) {
      const mapCount = (trimmed.match(/\.map\(/g) ?? []).length
      if (mapCount > 2) {
        findings.push({
          rule: "P-nested-map",
          severity: "warning",
          evidence: `nested map calls at line ${i + 1}`,
          fix: "consider flattening or using a more efficient approach",
        })
      }
    }

    if (trimmed.includes("JSON.parse") && trimmed.includes("await")) {
      findings.push({
        rule: "P-unnecessary-parse",
        severity: "warning",
        evidence: `JSON.parse with await at line ${i + 1}`,
        fix: "avoid repeated parsing; cache the parsed result",
      })
    }

    if (trimmed.includes("Promise.all") && trimmed.includes("fetch")) {
      findings.push({
        rule: "P-unbounded-concurrency",
        severity: "warning",
        evidence: `unbounded Promise.all with fetch at line ${i + 1}`,
        fix: "limit concurrency with a pool or batch the requests",
      })
    }
  }

  return findings
}

export * as PerformanceSlop from "./performance"