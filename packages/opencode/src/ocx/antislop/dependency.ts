export type DependencySlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanDependency(content: string, filePath: string): readonly DependencySlopFinding[] {
  const findings: DependencySlopFinding[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    const importMatch = trimmed.match(/import\s+.*\s+from\s+["']([^"']+)["']/)
    if (importMatch) {
      const dep = importMatch[1]
      if (dep.startsWith(".") || dep.startsWith("/")) continue
      if (dep.includes("node_modules")) continue

      const smallUtility = /^(?:lodash|underscore|ramda|date-fns|uuid|nanoid|rxjs|immer|zod|yup|joi|class-validator|validator)\b/
      if (smallUtility.test(dep) && trimmed.includes("import")) {
        findings.push({
          rule: "D-small-dependency",
          severity: "warning",
          evidence: `importing "${dep}" at line ${i + 1} for utility functionality`,
          fix: "consider whether the functionality can be implemented without a dependency",
        })
      }
    }

    if (trimmed.includes("require(") && !trimmed.includes("node_modules")) {
      const reqMatch = trimmed.match(/require\(\s*["']([^"']+)["']\s*\)/)
      if (reqMatch) {
        const dep = reqMatch[1]
        if (!dep.startsWith(".") && !dep.startsWith("/")) {
          findings.push({
            rule: "D-dynamic-require",
            severity: "warning",
            evidence: `dynamic require of "${dep}" at line ${i + 1}`,
            fix: "use static imports for better tree-shaking and type safety",
          })
        }
      }
    }
  }

  return findings
}

export * as DependencySlop from "./dependency"