import type { VerbositySignal } from "./types"

export type DuplicationOptions = {
  readonly minLines?: number
  readonly similarityThreshold?: number
}

export type TokenDriftRecord = {
  readonly turn: number
  readonly tokenCount: number
  readonly testAssertionCount: number
}

const DEFAULT_MIN_LINES = 4
const DEFAULT_SIMILARITY_THRESHOLD = 0.8

export function normalizeForCloneDetection(code: string): string {
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "")

  const normalizedTokens = withoutComments
    .replace(/\b(let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g, "$1 $ID")
    .replace(/\s+/g, " ")
    .trim()

  return normalizedTokens
}

export function tokenizeCode(code: string): readonly string[] {
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "")
  const tokens = withoutComments.match(/[a-zA-Z_$][a-zA-Z0-9_$]*|[^\s]/g) ?? []
  return tokens
}

export function computeTokenSimilarity(tokensA: readonly string[], tokensB: readonly string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0

  const countsA = new Map<string, number>()
  for (const t of tokensA) countsA.set(t, (countsA.get(t) ?? 0) + 1)

  const countsB = new Map<string, number>()
  for (const t of tokensB) countsB.set(t, (countsB.get(t) ?? 0) + 1)

  let intersection = 0
  for (const [token, countA] of countsA) {
    const countB = countsB.get(token) ?? 0
    intersection += Math.min(countA, countB)
  }

  const totalTokens = (tokensA.length + tokensB.length) / 2
  const similarity = parseFloat((intersection / totalTokens).toFixed(3))
  return similarity
}

export function computeNgramSimilarity(a: string, b: string, n = 3): number {
  if (a === b) return 1.0
  if (a.length < n || b.length < n) return 0.0

  const getGrams = (str: string): Set<string> => {
    const grams = new Set<string>()
    for (let i = 0; i <= str.length - n; i++) {
      grams.add(str.slice(i, i + n))
    }
    return grams
  }

  const setA = getGrams(a)
  const setB = getGrams(b)

  let intersection = 0
  for (const g of setA) {
    if (setB.has(g)) intersection++
  }

  const union = setA.size + setB.size - intersection
  if (union === 0) return 0.0

  const similarity = parseFloat((intersection / union).toFixed(3))
  return similarity
}

export function detectDuplication(
  files: Record<string, string>,
  options: DuplicationOptions = {},
): readonly VerbositySignal[] {
  const minLines = options.minLines ?? DEFAULT_MIN_LINES
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD
  const signals: VerbositySignal[] = []

  const fileEntries = Object.entries(files)

  for (let i = 0; i < fileEntries.length; i++) {
    const [fileA, codeA] = fileEntries[i]
    const linesA = codeA.split("\n")

    for (let j = i + 1; j < fileEntries.length; j++) {
      const [fileB, codeB] = fileEntries[j]
      const linesB = codeB.split("\n")

      if (linesA.length >= minLines && linesB.length >= minLines) {
        const normA = normalizeForCloneDetection(codeA)
        const normB = normalizeForCloneDetection(codeB)
        const ngramSim = computeNgramSimilarity(normA, normB)

        const tokensA = tokenizeCode(codeA)
        const tokensB = tokenizeCode(codeB)
        const tokenSim = computeTokenSimilarity(tokensA, tokensB)

        const sim = Math.max(ngramSim, tokenSim)

        if (sim >= threshold) {
          const signal: VerbositySignal = {
            rule: "anti-slop/duplicate-code",
            severity: "warning",
            target: `${fileA} <=> ${fileB}`,
            metricValue: sim,
            threshold,
            evidence: `High near-clone code duplication (${(sim * 100).toFixed(1)}% similarity) detected between ${fileA} and ${fileB}`,
            fix: "Extract duplicate logic into a shared helper function or utility module.",
          }
          signals.push(signal)
        }
      }
    }
  }

  return signals
}

export function detectWrapperBloat(code: string, file: string): readonly VerbositySignal[] {
  const signals: VerbositySignal[] = []
  const lines = code.split("\n")

  const passThroughPattern =
    /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\((.*?)\)\s*(?::\s*[^{]+)?\s*\{\s*return\s+(?:await\s+)?(?:[a-zA-Z_$][a-zA-Z0-9_$]*\.)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\((.*?)\);?\s*\}/g

  let match: RegExpExecArray | null
  while ((match = passThroughPattern.exec(code)) !== null) {
    const outerFn = match[1]
    const innerFn = match[3]

    if (outerFn !== innerFn) {
      const signal: VerbositySignal = {
        rule: "anti-slop/wrapper-bloat",
        severity: "warning",
        target: `${file}:${outerFn}`,
        metricValue: 1.0,
        threshold: 0.0,
        evidence: `Single-use pass-through wrapper '${outerFn}' forwards directly to '${innerFn}' without transformation.`,
        fix: `Inline calls to '${innerFn}' directly at caller sites to eliminate wrapper bloat.`,
      }
      signals.push(signal)
    }
  }

  const arrowPassThrough =
    /(?:export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:\(.*?\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>\s*(?:[a-zA-Z_$][a-zA-Z0-9_$]*\.)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(.*?\);?/g

  while ((match = arrowPassThrough.exec(code)) !== null) {
    const outerFn = match[1]
    const innerFn = match[2]
    if (outerFn !== innerFn && !outerFn.startsWith("use")) {
      const signal: VerbositySignal = {
        rule: "anti-slop/wrapper-bloat",
        severity: "warning",
        target: `${file}:${outerFn}`,
        metricValue: 1.0,
        threshold: 0.0,
        evidence: `Arrow pass-through wrapper '${outerFn}' delegates directly to '${innerFn}'.`,
        fix: `Use '${innerFn}' directly instead of wrapping in single-use delegate.`,
      }
      signals.push(signal)
    }
  }

  return signals
}

export function detectCommentSlop(code: string, file: string): readonly VerbositySignal[] {
  const signals: VerbositySignal[] = []
  const lines = code.split("\n")

  let commentLines = 0
  let codeLines = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
      commentLines++
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        const commentContent = line.replace(/^\/\/\s*|\/\*\s*|\*\s*/, "").toLowerCase()
        const fnMatch = /(?:function|const|let|var|class|interface|type)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(
          nextLine,
        )
        if (fnMatch) {
          const identifier = fnMatch[1].toLowerCase()
          if (
            commentContent === identifier ||
            commentContent === `gets ${identifier}` ||
            commentContent === `sets ${identifier}` ||
            commentContent === `${identifier} function`
          ) {
            const signal: VerbositySignal = {
              rule: "anti-slop/echo-comment",
              severity: "warning",
              target: `${file}:${i + 1}`,
              metricValue: 1.0,
              threshold: 0.0,
              evidence: `Echo comment '${line}' restates the name of identifier '${fnMatch[1]}'.`,
              fix: "Remove echo comment; well-named identifiers are self-documenting.",
            }
            signals.push(signal)
          }
        }
      }
    } else {
      codeLines++
    }
  }

  if (codeLines >= 10) {
    const ratio = parseFloat((commentLines / codeLines).toFixed(2))
    if (ratio > 0.3) {
      const signal: VerbositySignal = {
        rule: "anti-slop/comment-density-anomaly",
        severity: "warning",
        target: file,
        metricValue: ratio,
        threshold: 0.3,
        evidence: `High comment density (${(ratio * 100).toFixed(0)}% comments-to-code) obscures code structure.`,
        fix: "Remove redundant explanatory comments and rely on idiomatic typed code.",
      }
      signals.push(signal)
    }
  }

  return signals
}

export function calculateVerbosityIndex(tokenCount: number, minimalBaselineTokens: number): number {
  if (minimalBaselineTokens <= 0) return 1.0
  const index = parseFloat((tokenCount / minimalBaselineTokens).toFixed(2))
  return index
}

export function scanVerbositySignals(file: string, code: string): readonly VerbositySignal[] {
  const bloatSignals = detectWrapperBloat(code, file)
  const commentSignals = detectCommentSlop(code, file)
  return [...bloatSignals, ...commentSignals]
}

export * as VerbositySignals from "./verbosity"
