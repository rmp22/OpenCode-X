import {
  isProseFile,
  type StaticCheckFinding,
  type StaticCheckResult,
} from "./types"

function stripStringsAndComments(source: string): string {
  const out: string[] = []
  const len = source.length
  let i = 0
  let inLineComment = false
  let inBlockComment = false
  let inString: string | null = null
  let escaped = false

  while (i < len) {
    const ch = source[i]
    const next = i + 1 < len ? source[i + 1] : ""

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false
        out.push("\n")
      } else {
        out.push(" ")
      }
      i++
      continue
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false
        out.push("  ")
        i += 2
      } else {
        out.push(ch === "\n" ? "\n" : " ")
        i++
      }
      continue
    }

    if (inString !== null) {
      if (escaped) {
        escaped = false
        out.push(" ")
        i++
      } else if (ch === "\\") {
        escaped = true
        out.push(" ")
        i++
      } else if (ch === inString) {
        inString = null
        out.push(" ")
        i++
      } else {
        out.push(ch === "\n" ? "\n" : " ")
        i++
      }
      continue
    }

    if (ch === "/" && next === "/") {
      inLineComment = true
      out.push("  ")
      i += 2
      continue
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true
      out.push("  ")
      i += 2
      continue
    }

    if (ch === "#") {
      inLineComment = true
      out.push(" ")
      i++
      continue
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      out.push(" ")
      i++
      continue
    }

    out.push(ch)
    i++
  }

  return out.join("")
}

function checkBrackets(filePath: string, content: string): StaticCheckFinding[] {
  const stripped = stripStringsAndComments(content)
  const stack: Array<{ ch: string; line: number; column: number }> = []
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" }
  const lines = stripped.split("\n")

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]
      if (ch === "(" || ch === "[" || ch === "{") {
        stack.push({ ch, line: lineIdx + 1, column: col + 1 })
      } else if (ch === ")" || ch === "]" || ch === "}") {
        const top = stack.pop()
        if (!top) {
          return [
            {
              code: "ERR_BRACKET_IMBALANCE",
              severity: "error",
              message: `Unmatched closing bracket '${ch}' at line ${lineIdx + 1}, col ${col + 1}. An opening bracket is missing before this point.`,
              filePath,
              line: lineIdx + 1,
              column: col + 1,
              symbol: ch,
            },
          ]
        }
        if (top.ch !== pairs[ch]) {
          return [
            {
              code: "ERR_BRACKET_IMBALANCE",
              severity: "error",
              message: `Mismatched brackets: '${top.ch}' opened at line ${top.line} is closed by '${ch}' at line ${lineIdx + 1}, col ${col + 1}.`,
              filePath,
              line: lineIdx + 1,
              column: col + 1,
              symbol: ch,
            },
          ]
        }
      }
    }
  }

  if (stack.length > 0) {
    const first = stack[0]
    return [
      {
        code: "ERR_BRACKET_IMBALANCE",
        severity: "error",
        message: `Unclosed bracket '${first.ch}' opened at line ${first.line}, col ${first.column}. ${stack.length} bracket(s) never closed before end of file.`,
        filePath,
        line: first.line,
        column: first.column,
        symbol: first.ch,
      },
    ]
  }

  return []
}

function checkXmlTags(filePath: string, content: string): StaticCheckFinding[] {
  const stripped = content.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length))
  const tagPattern = /<\/?([A-Za-z][A-Za-z0-9_.:-]*)[^>]*?>/g
  const stack: Array<{ name: string; line: number }> = []
  const lines = stripped.split("\n")
  const voidElements = new Set(["br", "hr", "img", "input", "link", "meta", "area", "base", "col", "embed", "source", "track", "wbr"])

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    let match: RegExpExecArray | null
    tagPattern.lastIndex = 0
    while ((match = tagPattern.exec(line)) !== null) {
      const full = match[0]
      const name = match[1]
      const isClose = full.startsWith("</")
      const isSelfClose = full.endsWith("/>") || voidElements.has(name.toLowerCase())
      if (isClose) {
        const top = stack.pop()
        if (!top) {
          return [
            {
              code: "ERR_XML_TAG_MISMATCH",
              severity: "error",
              message: `Unmatched closing tag '</${name}>' at line ${lineIdx + 1} with no open tag.`,
              filePath,
              line: lineIdx + 1,
              column: (match.index ?? 0) + 1,
              symbol: name,
            },
          ]
        }
        if (top.name !== name) {
          return [
            {
              code: "ERR_XML_TAG_MISMATCH",
              severity: "error",
              message: `Mismatched tags: '<${top.name}>' opened at line ${top.line} is closed by '</${name}>' at line ${lineIdx + 1}.`,
              filePath,
              line: lineIdx + 1,
              column: (match.index ?? 0) + 1,
              symbol: name,
            },
          ]
        }
      } else if (!isSelfClose) {
        stack.push({ name, line: lineIdx + 1 })
      }
    }
  }

  if (stack.length > 0) {
    const first = stack[0]
    return [
      {
        code: "ERR_XML_TAG_MISMATCH",
        severity: "error",
        message: `Unclosed tag '<${first.name}>' opened at line ${first.line}. ${stack.length} tag(s) never closed before end of file.`,
        filePath,
        line: first.line,
        column: 1,
        symbol: first.name,
      },
    ]
  }

  return []
}

export class UniversalChecks {
  static audit(filePath: string, content: string, language?: string): StaticCheckResult {
    const lang = language ?? (filePath.split(".").pop() ?? "")
    const findings: StaticCheckFinding[] = []

    if (content.includes("\0")) {
      findings.push({
        code: "ERR_NULL_BYTE",
        severity: "error",
        message: "File contains null bytes. The file may be binary or corrupted; text edits are unsafe.",
        filePath,
        line: 1,
        column: 1,
      })
    }

    const crlfLines = content.split("\n").filter((line) => line.endsWith("\r")).length
    const totalLines = content.split("\n").length
    const lfLines = totalLines - crlfLines
    if (crlfLines > 0 && lfLines > 0) {
      findings.push({
        code: "WARN_MIXED_LINE_ENDINGS",
        severity: "warning",
        message: `Mixed line endings: ${crlfLines} CRLF line(s) and ${lfLines} LF line(s). Normalize to LF to keep exact-match edits predictable.`,
        filePath,
        line: 1,
        column: 1,
      })
    }

    if (lang === "json") {
      try {
        JSON.parse(content)
      } catch (error: any) {
        findings.push({
          code: "ERR_JSON_SYNTAX",
          severity: "error",
          message: `JSON syntax error: ${error?.message ?? "malformed JSON"}`,
          filePath,
          line: 1,
          column: 1,
        })
      }
      return finalize(filePath, lang, findings)
    }

    if (!isProseFile(filePath) && lang !== "xml" && lang !== "html" && lang !== "vue") {
      findings.push(...checkBrackets(filePath, content))
      findings.push(...checkDeadCode(filePath, content))
      findings.push(...checkNoopCode(filePath, content))
      findings.push(...checkEmptyCatch(filePath, content))
      findings.push(...checkDebugLeftovers(filePath, content))
      findings.push(...checkAiSlopComments(filePath, content))
    }

    if (lang === "xml" || lang === "html" || lang === "vue") {
      findings.push(...checkXmlTags(filePath, content))
    }

    return finalize(filePath, lang, findings)
  }
}

function checkDeadCode(filePath: string, content: string): StaticCheckFinding[] {
  const findings: StaticCheckFinding[] = []
  const lines = content.split("\n")
  const TERMINAL_STMT = /^\s*(?:return(?:\s+[^;]+)?|throw(?:\s+[^;]+)?|raise(?:\s+[^;]+)?|break|continue|process\.exit\([^)]*\)|System\.exit\([^)]*\)|panic!\([^)]*\))\s*;?\s*$/
  const BLOCK_BOUNDARY = /^\s*(?:\}|catch\b|finally\b|else\b|elif\b|case\b|default:)/

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]
    if (!TERMINAL_STMT.test(line)) continue

    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j]
      const trimmed = nextLine.trim()
      if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue
      if (BLOCK_BOUNDARY.test(nextLine)) break

      findings.push({
        code: "ERR_DEAD_CODE",
        severity: "error",
        message: `Unreachable dead code detected after terminating statement '${line.trim()}'`,
        filePath,
        line: j + 1,
        column: nextLine.indexOf(trimmed) + 1,
        fixSuggestion: "Remove unreachable code or reorder statements before the terminal return/throw/break.",
      })
      break
    }
  }
  return findings
}

function checkNoopCode(filePath: string, content: string): StaticCheckFinding[] {
  const findings: StaticCheckFinding[] = []
  const lines = content.split("\n")
  const SELF_ASSIGN = /^\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*=\s*\1\s*;?\s*$/
  const EMPTY_BLOCK = /\b(?:if|while|for)\s*\([^)]*\)\s*\{\s*\}|\belse\s*\{\s*\}/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(SELF_ASSIGN)
    if (match) {
      findings.push({
        code: "ERR_NOOP_CODE",
        severity: "error",
        message: `No-op self-assignment detected: '${match[1]} = ${match[1]}'`,
        filePath,
        line: i + 1,
        column: line.indexOf(match[1]) + 1,
        symbol: match[1],
        fixSuggestion: `Remove self-assignment '${match[1]} = ${match[1]}' or wire with actual computed value.`,
      })
      continue
    }

    if (EMPTY_BLOCK.test(line)) {
      findings.push({
        code: "ERR_NOOP_CODE",
        severity: "error",
        message: "Empty control flow block detected without statements",
        filePath,
        line: i + 1,
        column: 1,
        fixSuggestion: "Provide implementation for block or remove empty control statement.",
      })
    }
  }
  return findings
}

function checkEmptyCatch(filePath: string, content: string): StaticCheckFinding[] {
  const findings: StaticCheckFinding[] = []
  const lines = content.split("\n")
  const EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}|\bexcept(?:\s+[^:]+)?:\s*pass\s*$/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (EMPTY_CATCH.test(line)) {
      findings.push({
        code: "ERR_EMPTY_CATCH",
        severity: "error",
        message: "Empty catch/except block silently swallows errors",
        filePath,
        line: i + 1,
        column: 1,
        fixSuggestion: "Handle, log, or rethrow the caught error instead of silently swallowing it.",
      })
    }
  }
  return findings
}

function checkDebugLeftovers(filePath: string, content: string): StaticCheckFinding[] {
  if (
    filePath.includes("test") ||
    filePath.includes("spec") ||
    filePath.endsWith("_test.go") ||
    filePath.endsWith("Test.java")
  ) {
    return []
  }
  const findings: StaticCheckFinding[] = []
  const lines = content.split("\n")
  const DEBUG_PATTERNS = [
    { regex: /\bconsole\.(?:log|debug|trace)\s*\(/, name: "console.log" },
    { regex: /\bSystem\.(?:out|err)\.print(?:ln)?\s*\(/, name: "System.out.println" },
    { regex: /\bfmt\.(?:Println|Printf|Print)\s*\(/, name: "fmt.Println" },
    { regex: /\bprintln!\s*\(/, name: "println!" },
    { regex: /\bdebugger\s*;/, name: "debugger" },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue
    for (const pattern of DEBUG_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          code: "ERR_DEBUG_LEFTOVER",
          severity: "warning",
          message: `Leftover debug statement detected: '${pattern.name}'`,
          filePath,
          line: i + 1,
          column: line.search(pattern.regex) + 1,
          fixSuggestion: `Remove debug call '${pattern.name}' before finalizing changes.`,
        })
        break
      }
    }
  }
  return findings
}

function checkAiSlopComments(filePath: string, content: string): StaticCheckFinding[] {
  const findings: StaticCheckFinding[] = []
  const lines = content.split("\n")
  const SLOP_PATTERNS = [
    /\/\/\s*(?:explain(?:s|ed|ing)?\s+code|code\s+explanation|explanatory(?:\s+comment)?|explain\s+this)\b/i,
    /\/\*\s*(?:explain(?:s|ed|ing)?\s+code|code\s+explanation|explanatory(?:\s+comment)?)\s*\*\//i,
    /\/\/\s*TODO:?\s*(?:implement|fill in|add logic|replace with real|placeholder)\b/i,
    /\/\*\s*TODO:?\s*(?:implement|fill in|add logic|replace with real|placeholder)\b.*?\*\//i,
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes("@ts-") || line.includes("@eslint") || line.includes("@hide") || line.includes("eslint-disable")) {
      continue
    }
    for (const pattern of SLOP_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          code: "ERR_AI_SLOP_COMMENT",
          severity: "error",
          message: "Explanatory comment or placeholder stub detected (AI slop)",
          filePath,
          line: i + 1,
          column: 1,
          fixSuggestion: "Remove explanatory comments and placeholder stubs. Keep code clean without explaining comments.",
        })
        break
      }
    }
  }
  return findings
}

function finalize(filePath: string, language: string, findings: StaticCheckFinding[]): StaticCheckResult {
  return {
    passed: findings.filter((f) => f.severity === "error").length === 0,
    filePath,
    language,
    findings,
  }
}
