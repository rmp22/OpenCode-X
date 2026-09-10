export type InconsistencySlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanInconsistency(content: string, filePath: string): readonly InconsistencySlopFinding[] {
  const findings: InconsistencySlopFinding[] = []
  const lines = content.split("\n")

  const namingStyles = { camelCase: 0, PascalCase: 0, snake_case: 0, UPPER_CASE: 0 }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    const camelMatch = trimmed.match(/const\s+([a-z][a-zA-Z]+)/)
    if (camelMatch) namingStyles.camelCase++

    const pascalMatch = trimmed.match(/class\s+([A-Z][a-zA-Z]+)/)
    if (pascalMatch) namingStyles.PascalCase++

    const snakeMatch = trimmed.match(/(?:const|let|var)\s+([a-z]+_[a-z_]+)/)
    if (snakeMatch) namingStyles.snake_case++

    const upperMatch = trimmed.match(/(?:const|let|var)\s+([A-Z_]+)/)
    if (upperMatch) namingStyles.UPPER_CASE++
  }

  const styles = Object.entries(namingStyles).filter(([, count]) => count > 0)
  if (styles.length > 2) {
    findings.push({
      rule: "I-mixed-naming-styles",
      severity: "warning",
      evidence: `mixed naming conventions detected: ${styles.map(([s]) => s).join(", ")}`,
      fix: "follow the existing project naming convention",
    })
  }

  return findings
}

export * as InconsistencySlop from "./inconsistency"