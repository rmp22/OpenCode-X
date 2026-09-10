export type ReasonFinding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

const MAX_FINDINGS = 3

const ARITH_CLAIM = /\b(\d{1,7})\s*([+\-*×÷/])\s*(\d{1,7})\s*=\s*(-?\d{1,15})\b/g
const REVERSAL =
  /\b(?:scratch that|never ?mind|wait,?\s*no\b|correction\s*:|ignore (?:that|what i said)|disregard my (?:last|previous))\b/gi

const REVERSAL_MIN = 2

function compute(a: number, op: string, b: number): number | undefined {
  if (op === "+") return a + b
  if (op === "-") return a - b
  if (op === "*" || op === "×") return a * b
  if (op === "/" || op === "÷") return b === 0 ? undefined : a / b
  return undefined
}

export function arithmeticFindings(body: string): ReasonFinding[] {
  if (!body) return []
  const out: ReasonFinding[] = []
  const seen = new Set<string>()
  for (const match of body.matchAll(ARITH_CLAIM)) {
    const [, rawA, op, rawB, rawClaimed] = match
    const a = Number(rawA)
    const b = Number(rawB)
    const claimed = Number(rawClaimed)
    const expected = compute(a, op, b)
    if (expected === undefined) continue
    if (Math.abs(expected - claimed) <= Math.max(1e-9, Math.abs(expected) * 1e-9)) continue
    const span = match[0]
    if (seen.has(span)) continue
    seen.add(span)
    out.push({
      id: "R1-arithmetic-slip",
      message: `reply prints "${span.trim()}" but ${a} ${op} ${b} computes to ${expected}; run the calculation through code or the shell and print the executed result`,
      span,
    })
    if (out.length >= MAX_FINDINGS) break
  }
  return out
}

export function reversalFindings(body: string): ReasonFinding[] {
  if (!body) return []
  const count = [...body.matchAll(REVERSAL)].length
  if (count < REVERSAL_MIN) return []
  return [
    {
      id: "R2-shipped-reversal",
      message: `reply carries ${count} self-reversals; resolve the tradeoff internally and ship one answer with the fallback named`,
      span: `${count} reversals`,
    },
  ]
}

export * as ReasonGate from "./reason-gate"
