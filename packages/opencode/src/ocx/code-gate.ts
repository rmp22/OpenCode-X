export type CodeFinding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

const BARE_EXCEPT = /^\s*except\s*:/i
const MUTABLE_DEFAULT = /\bdef\s+\w+\s*\([^)]*=\s*(?:\[\]|\{\})[^)]*\)/
const PY_PRINT = /(?<!\w)print\s*\(/i

const EVAL_EXEC = /(?<![\w.])(?:eval|exec)\s*\(|new\s+Function\s*\(/i
const HTML_WRITE = /\.innerHTML\s*=|document\.write\s*\(/i

const TEST_PATH = /(?:^|[\/_.])(?:test|spec|conftest)/i

const FQN_INLINE = /(?:^|(?:\b(?:new|extends|implements|instanceof|throws|return|catch)\b|[=:<(,])\s*)(?:[a-z][\w$]*\.){2,}[A-Z][A-Za-z0-9_$]*(?:\.[A-Za-z_$][\w$]*)*(?=\s*(?:\(|[<>,;)\]}]|$))/
const JVM_STRING = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
const PLACEHOLDER_DECLARATION = /^\s*(?:(?:export|public|private|protected|internal|abstract|final|static|sealed|data|open|async|override|virtual|inline|mutating)\s+)*(?:function|class|interface|type|enum|struct|record|def|fn|func|fun|object|trait|protocol)\s+(?:foo|bar|baz|foobar|thing|stuff|doThing|doStuff|someFunction|myFunction)\b/i
const NAMING_CODE_PATH = /\.(?:c|cc|cpp|cs|css|dart|go|h|hpp|java|js|jsx|json|kt|kts|mjs|php|py|rb|rs|scala|scss|sh|sql|swift|ts|tsx|vue|xml|ya?ml)$/i

const EMPTY_SCAFFOLD = /\b(?:override\s+)?(?:fun|function)\s+\w+\s*\([^)]*\)[^{;]*\{\s*\}\s*$/
const PY_DEF = /^\s*def\s+\w+\s*\([^)]*\):\s*$/
const PY_PASS = /^\s*pass\s*$/
const DUPLICATE_BLOCK_LINES = 3
const SIGNIFICANT_LINE_MIN = 12

function significant(line: string): string | undefined {
  const normalized = line.trim().replace(/\s+/g, " ")
  if (
    normalized.length < SIGNIFICANT_LINE_MIN ||
    /^[\s{}()[\];,.<>]+$/.test(normalized) ||
    /^(?:import |from |#|\/\/|\*|\/\*)/.test(normalized)
  )
    return undefined
  return normalized
}

function duplicateBlockFinding(lines: readonly string[]): CodeFinding | undefined {
  const kept: { index: number; text: string }[] = []
  for (const [index, line] of lines.entries()) {
    const text = significant(line)
    if (text !== undefined) kept.push({ index, text })
  }
  if (kept.length < DUPLICATE_BLOCK_LINES * 2) return undefined
  const counts = new Map<string, number[]>()
  for (let start = 0; start + DUPLICATE_BLOCK_LINES <= kept.length; start++) {
    const window = kept.slice(start, start + DUPLICATE_BLOCK_LINES)
    const contiguous = window.every(
      (item, position) => position === 0 || item.index - window[position - 1].index === 1,
    )
    if (!contiguous) continue
    const key = window.map((item) => item.text).join("\n")
    const positions = counts.get(key) ?? []
    positions.push(start)
    counts.set(key, positions)
  }
  for (const [, starts] of counts) {
    let occurrences = 0
    let lastEnd = -1
    for (const start of starts) {
      if (start <= lastEnd) continue
      occurrences++
      if (occurrences >= 2)
        return {
          id: "F12-duplicate-block",
          message: "the same block is pasted twice in this file; extract it into one named function",
          span: kept[start].text.slice(0, 80),
        }
      lastEnd = start + DUPLICATE_BLOCK_LINES - 1
    }
  }
  return undefined
}

function emptyScaffoldFindings(path: string, lines: readonly string[]): CodeFinding[] {
  const out: CodeFinding[] = []
  const isPy = path.endsWith(".py")
  for (const [index, line] of lines.entries()) {
    if (!isPy && EMPTY_SCAFFOLD.test(line)) {
      out.push({
        id: "F13-empty-scaffold",
        message: "empty scaffolded body ships dead surface; delete it or implement it before delivery",
        span: line.trim().slice(0, 80),
      })
      break
    }
    if (
      isPy &&
      PY_DEF.test(line) &&
      (lines[index + 1] ? PY_PASS.test(lines[index + 1]) : false)
    ) {
      out.push({
        id: "F13-empty-scaffold",
        message: "def-with-pass scaffold does nothing; delete it or implement it before delivery",
        span: `${line.trim()} / pass`,
      })
      break
    }
  }
  return out.slice(0, 1)
}

function jvmCode(line: string): string {
  return line.replace(JVM_STRING, " ").replace(/\/\/.*$/, "")
}

export function lineFindings(path: string, lines: readonly string[]): CodeFinding[] {
  const out: CodeFinding[] = []
  const seen = new Set<string>()
  const fire = (id: string, line: string, message: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, message, span: line.trim().slice(0, 80) })
  }
  const isPy = path.endsWith(".py")
  const isJs = /\.(ts|tsx|js|jsx|mjs)$/.test(path)
  const isJvm = /\.(kt|java)$/.test(path)
  const isNamingCode = NAMING_CODE_PATH.test(path)
  if (!isPy && !isJs && !isJvm && !isNamingCode) return out
  for (const line of lines) {
    if (isPy) {
      if (BARE_EXCEPT.test(line)) fire("F2-bare-except", line, "bare except hides every failure; catch the specific errors this block can raise")
      if (MUTABLE_DEFAULT.test(line)) fire("F3-mutable-default", line, "mutable default argument keeps state between calls; default to None and assign inside")
      if (!TEST_PATH.test(path) && PY_PRINT.test(line)) fire("F4-debug-print", line, "debug print left in non-test code; remove it or log through a logger")
      if (EVAL_EXEC.test(line)) fire("F5-eval-exec", line, "eval/exec executes strings as code; parse input or use a safe alternative")
    }
    if (isJs) {
      if (EVAL_EXEC.test(line)) fire("F5-eval-exec", line, "eval/new Function executes strings as code; parse input or use a safe alternative")
      if (HTML_WRITE.test(line)) fire("F6-innerhtml-write", line, "innerHTML/document.write bypasses sanitization; set textContent or sanitize before injecting")
    }
    if (isJvm) {
      const trimmed = line.trim()
      const isDeclaration = /^(?:package |import )(?:static )?/.test(trimmed)
      const fqnMessage = path.endsWith(".kt")
        ? "inline FQN call or type; import the class and use the short name, alias with `as` when ambiguous"
        : "inline FQN call or type; import the class and use the short name. Java has no import alias: qualify only a genuine name collision inline, or wrap one side"
      const code = jvmCode(line)
      const isComment = /^(?:\/\/|\/\*|\*|#)/.test(trimmed)
      if (!isDeclaration && !trimmed.startsWith("@") && !isComment && FQN_INLINE.test(code)) fire("F14-fqn-inline", line, fqnMessage)
    }
    if (isNamingCode && !TEST_PATH.test(path) && PLACEHOLDER_DECLARATION.test(line))
      fire("F15-placeholder-name", line, "placeholder declaration name; name it by responsibility, data, state, or action")
  }
  out.push(...emptyScaffoldFindings(path, lines))
  if (isJvm || isJs || isPy) {
    const duplicate = duplicateBlockFinding(lines)
    if (duplicate) out.push(duplicate)
  }
  return out
}

const IMG_NO_ALT = /<img(?![^>]*\balt=)[^>]*>/gi
const BLANK_NO_OPENER = /<a\b[^>]*target=["']?_blank["']?(?![^>]*\brel=["'][^"']*noopener)[^>]*>/gi
const CLICK_DIV = /<(?:div|span)\b[^>]*\bonclick\b(?![^>]*\brole=["']?button)(?![^>]*tabindex=)[^>]*>/gi

export function webFindings(html: string): CodeFinding[] {
  if (!html) return []
  const out: CodeFinding[] = []
  const seen = new Set<string>()
  const fire = (id: string, message: string, span?: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, message, ...(span ? { span } : {}) })
  }
  for (const match of html.matchAll(IMG_NO_ALT))
    fire("F7-img-missing-alt", "image without alt text; add descriptive alt, or alt=\"\" for decoration", match[0].slice(0, 80))
  for (const match of html.matchAll(BLANK_NO_OPENER))
    fire("F8-blank-no-opener", 'target="_blank" without rel="noopener"; new tabs can reach window.opener', match[0].slice(0, 80))
  for (const match of html.matchAll(CLICK_DIV))
    fire("F9-div-onclick", "click handler on div/span is keyboard-invisible; use <button> or add role=\"button\", tabindex, and key handling", match[0].slice(0, 80))
  if (/<html[\s>]/i.test(html)) {
    if (!/<html[^>]*\blang=/i.test(html))
      fire("F10-html-no-lang", "<html> without lang attribute; screen readers pick the wrong voice and hyphenation breaks")
    if (!/name=["']?viewport/i.test(html))
      fire("F11-no-viewport", "no viewport meta tag; mobile browsers render at desktop width and scale down")
  }
  return out
}

export * as CodeGate from "./code-gate"
