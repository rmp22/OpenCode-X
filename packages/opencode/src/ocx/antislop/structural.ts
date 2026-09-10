export type StructuralSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

const CODE_EXTENSIONS = /\.(?:[jt]sx?|py|go|rs|java|kt|cpp|cxx|cc|c|h|hpp|cs)$/i

export function scanStructural(content: string, filePath: string): readonly StructuralSlopFinding[] {
  const findings: StructuralSlopFinding[] = []
  if (!CODE_EXTENSIONS.test(filePath)) return findings
  const lines = content.split("\n")

  const functionCount = lines.filter((l) =>
    /^\s*(?:export\s+)?(?:function|const\s+\w+\s*=\s*(?:async\s+)?(?:function|\(|=>)|def\s+\w+|func\s+(?:\([^)]+\)\s+)?\w+|fn\s+\w+|fun\s+\w+)/m.test(l)
  ).length
  const classCount = lines.filter((l) => /^\s*(?:export\s+)?(?:class|struct|interface|impl)\s+\w+/.test(l)).length
  const methodCount = lines.filter((l) =>
    /^\s+(?:(?:public|private|protected|async|fun|def)\s+)*\w+\s*\([^)]*\)\s*[{:]/.test(l) &&
    !/^\s*(?:export\s+)?(?:function|class|interface|type|const|import|export)\b/.test(l)
  ).length

  if ((functionCount > 50 || lines.length > 500) && !filePath.includes("generated")) {
    findings.push({
      rule: "S-god-file",
      severity: "warning",
      evidence: `${functionCount} functions or ${lines.length} lines in a single file`,
      fix: "split into modules by responsibility",
    })
  }

  if (classCount > 5 && !filePath.includes(".d.ts")) {
    findings.push({
      rule: "S-god-class",
      severity: "warning",
      evidence: `${classCount} classes/types in a single file`,
      fix: "split into separate files by domain",
    })
  }

  if (methodCount > 20) {
    findings.push({
      rule: "S-god-method",
      severity: "warning",
      evidence: `${methodCount} methods in a single class or module`,
      fix: "extract related methods into dedicated classes or helper modules",
    })
  }

  const nestedDepth = maxBlockDepth(content)
  if (nestedDepth > 5) {
    findings.push({
      rule: "S-deep-nesting",
      severity: "warning",
      evidence: `maximum block depth of ${nestedDepth}`,
      fix: "simplify control flow with early returns, guard clauses, or lookup tables",
    })
  }

  if (
    /module\.exports\s*=/m.test(content) &&
    !/(?:test|spec|\.cjs$|webpack|vite|rollup|scripts?\/)/i.test(filePath) &&
    !/typeof\s+module\s*!==\s*['"]undefined['"]/.test(content)
  ) {
    findings.push({
      rule: "S-unguarded-cjs-export",
      severity: "blocker",
      evidence: `unguarded module.exports in client-side script in ${filePath}`,
      fix: "use ES modules or guard CommonJS exports with typeof module !== 'undefined' check",
    })
  }

  if (/catch\s*\([^)]*\)\s*\{\s*return\s*(?:null|false|\[\]|""|undefined)?\s*;?\s*\}/.test(content)) {
    findings.push({
      rule: "S-error-swallowing",
      severity: "warning",
      evidence: `blanket try-catch swallowing errors and returning empty default in ${filePath}`,
      fix: "handle errors explicitly with logging, typed Result/Option, or rethrow to error boundary",
    })
  }

  return findings
}

function maxBlockDepth(code: string): number {
  let max = 0
  let current = 0
  let quote: string | undefined
  let lineComment = false
  let blockComment = false
  let escaped = false

  for (let i = 0; i < code.length; i++) {
    const char = code[i]
    const next = code[i + 1]
    if (lineComment) {
      if (char === "\n") lineComment = false
      continue
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; i++ }
      continue
    }
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (char === "\\") { escaped = true; continue }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "/" && next === "/") { lineComment = true; i++; continue }
    if (char === "/" && next === "*") { blockComment = true; i++; continue }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue }
    if (char === "{") { current++; max = Math.max(max, current) }
    else if (char === "}") current = Math.max(0, current - 1)
  }
  return max
}


export * as StructuralSlop from "./structural"
