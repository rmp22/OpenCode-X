import type { LedgerEntry, Message } from "../ledger"
import { Ledger } from "../ledger"

export type State = {
  readonly detected: boolean
  readonly program?: string
  readonly attempts: number
}

const STREAK = 3

function programOf(command: string): string {
  return command.trim().split(/\s+/, 1)[0] ?? ""
}

export function inspect(messages: ReadonlyArray<Message>): State {
  const entries = Ledger.ledger(messages)
  const tail: Extract<LedgerEntry, { kind: "command" }>[] = []
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!
    if (entry.kind !== "command") break
    tail.unshift(entry)
  }
  if (tail.length < STREAK) return { detected: false, attempts: 0 }
  const program = programOf(tail[0]!.command)
  if (!program) return { detected: false, attempts: 0 }
  const batchable = tail.every(
    (entry) => entry.outcome !== "failed" && entry.check === undefined && programOf(entry.command) === program,
  )
  if (!batchable) return { detected: false, attempts: 0 }
  return { detected: true, program, attempts: tail.length }
}

export function directive(messages: ReadonlyArray<Message>): string | undefined {
  const state = inspect(messages)
  if (!state.detected) return undefined
  return [
    "=== OCX BATCH OPPORTUNITY ===",
    `Low-leverage repetition detected: ${state.attempts} consecutive \`${state.program}\` commands completed with no read or check between them.`,
    "Batch them: one shell loop that performs every repetition, then a single verification listing.",
    "Do not spend another turn on one download or one listing at a time.",
    "=== END OCX BATCH OPPORTUNITY ===",
  ].join("\n")
}

export * as LoopGuard from "./loop-guard"
