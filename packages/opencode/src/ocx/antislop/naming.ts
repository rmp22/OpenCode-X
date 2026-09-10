import { IdentifierShapeAnalyzer } from "./identifier-shape"

export type NamingSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanNaming(content: string, filePath: string): readonly NamingSlopFinding[] {
  const findings: NamingSlopFinding[] = []

  for (const finding of IdentifierShapeAnalyzer.scanSource(content, filePath)) {
    findings.push({
      rule: finding.rule,
      severity: finding.severity,
      evidence: finding.evidence,
      fix: finding.fix,
    })
  }

  return findings
}

export * as NamingSlop from "./naming"
