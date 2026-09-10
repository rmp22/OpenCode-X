export type ArchitectureSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function isGeneratedOrSchemaFile(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  if (lower.includes("/generated/") || lower.includes(".generated.") || lower.includes("generated-")) {
    return true
  }
  if (lower.endsWith("schema.ts") || lower.includes("/schema/") || lower.endsWith("types.ts")) {
    return true
  }
  return false
}

export function isDispatcherOrStateMachine(code: string): boolean {
  const switchCount = (code.match(/\bswitch\s*\(/g) ?? []).length
  const caseCount = (code.match(/\bcase\s+[^:]+:/g) ?? []).length
  if (switchCount >= 1 && caseCount >= 4) {
    return true
  }
  if (code.includes("match(") || code.includes("reducer") || code.includes("transitionTable")) {
    return true
  }
  return false
}

export function calculateMaxNestingDepth(content: string): number {
  let currentDepth = 0
  let maxDepth = 0
  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    if (char === "{" || char === "(") {
      currentDepth++
      if (currentDepth > maxDepth) {
        maxDepth = currentDepth
      }
    } else if (char === "}" || char === ")") {
      if (currentDepth > 0) {
        currentDepth--
      }
    }
  }
  return maxDepth
}

export function estimateCyclomaticComplexity(code: string): number {
  if (isDispatcherOrStateMachine(code)) {
    const nonCaseBranches = (code.match(/\b(?:if|while|for|catch)\b|\?\?|&&|\|\|/g) ?? []).length
    return nonCaseBranches + 1
  }
  const decisions = (code.match(/\b(?:if|while|for|case|catch)\b|\?\?|&&|\|\|/g) ?? []).length
  return decisions + 1
}

export function scanArchitectureSlop(content: string, filePath: string): readonly ArchitectureSlopFinding[] {
  if (isGeneratedOrSchemaFile(filePath)) {
    const empty: readonly ArchitectureSlopFinding[] = []
    return empty
  }

  const findings: ArchitectureSlopFinding[] = []
  const lines = content.split("\n")
  const nonEmptyLines = lines.filter((l) => {
    const t = l.trim()
    return t.length > 0 && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*")
  })

  if (nonEmptyLines.length > 800) {
    const item: ArchitectureSlopFinding = {
      rule: "A-file-length-excessive",
      severity: "blocker",
      evidence: "file length " + nonEmptyLines.length + " lines exceeds maximum threshold of 800 lines",
      fix: "split file into cohesive domain modules with single responsibilities",
    }
    findings.push(item)
  } else if (nonEmptyLines.length > 400) {
    const item: ArchitectureSlopFinding = {
      rule: "A-file-length-high",
      severity: "warning",
      evidence: "file length " + nonEmptyLines.length + " lines exceeds warning threshold of 400 lines",
      fix: "consider extracting reusable utilities or sub-components into separate files",
    }
    findings.push(item)
  }

  const fnRegex = /(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>))\s*\(([^)]*)\)/g
  let fnMatch: RegExpExecArray | null
  while ((fnMatch = fnRegex.exec(content)) !== null) {
    const paramsStr = fnMatch[3].trim()
    if (paramsStr.length > 0) {
      const params = paramsStr.split(",").map((p) => p.trim()).filter((p) => p.length > 0)
      if (params.length > 5) {
        const item: ArchitectureSlopFinding = {
          rule: "A-parameter-count-high",
          severity: "warning",
          evidence: "function declares " + params.length + " parameters",
          fix: "bundle parameters into an options interface (e.g. options: { ... })",
        }
        findings.push(item)
      }
    }
  }

  const maxNesting = calculateMaxNestingDepth(content)
  if (maxNesting > 12) {
    const item: ArchitectureSlopFinding = {
      rule: "A-deeply-nested-control-flow",
      severity: "blocker",
      evidence: "control flow nesting depth " + maxNesting + " exceeds maximum limit of 12",
      fix: "collapse nested conditionals into guard clauses with early returns",
    }
    findings.push(item)
  } else if (maxNesting > 8) {
    const item: ArchitectureSlopFinding = {
      rule: "A-deeply-nested-control-flow",
      severity: "warning",
      evidence: "control flow nesting depth " + maxNesting + " exceeds recommended limit of 8",
      fix: "collapse nested conditionals into guard clauses with early returns",
    }
    findings.push(item)
  }

  const complexity = estimateCyclomaticComplexity(content)
  if (complexity > 40) {
    const item: ArchitectureSlopFinding = {
      rule: "A-cyclomatic-complexity-excessive",
      severity: "blocker",
      evidence: "cyclomatic complexity " + complexity + " exceeds blocker threshold of 40",
      fix: "extract switch branches into handler map or decompose into smaller pure functions",
    }
    findings.push(item)
  } else if (complexity > 20) {
    const item: ArchitectureSlopFinding = {
      rule: "A-cyclomatic-complexity-high",
      severity: "warning",
      evidence: "cyclomatic complexity " + complexity + " exceeds warning threshold of 20",
      fix: "simplify branch conditions and use early returns to reduce cognitive complexity",
    }
    findings.push(item)
  }

  return findings
}

export * as ArchitectureSlop from "./architecture"
