import type { LedgerEntry, Message } from "../ledger"
import { Ledger } from "../ledger"
import { Resourcefulness } from "./resourcefulness"

export type State = {
  readonly detected: boolean
  readonly attempts: number
  readonly reason?: string
}

export function inspect(messages: ReadonlyArray<Message>): State {
  const entries = Ledger.ledger(messages)
  const commands = entries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: "command" }> => entry.kind === "command",
  )
  const repeatedCommand = commands.length >= 3 && commands.slice(-3).every((entry) => entry.command === commands.at(-1)?.command && entry.outcome === "failed")
  if (repeatedCommand) {
    return {
      detected: true,
      attempts: 2,
      reason: `the same failed command was repeated three times: ${commands.at(-1)?.command}`,
    }
  }

  const reads = entries.filter((entry): entry is Extract<LedgerEntry, { kind: "read" }> => entry.kind === "read")
  const readTail = reads.slice(-2)
  const repeatedRead = readTail.length === 2 && readTail[0].path === readTail[1].path
  if (repeatedRead) return { detected: true, attempts: 1, reason: `the same path was read repeatedly: ${readTail[1].path}` }

  const edits = entries.filter((entry): entry is Extract<LedgerEntry, { kind: "edit" }> => entry.kind === "edit")
  const editTail = edits.slice(-3)
  const repeatedEdit = editTail.length === 3 && editTail.every((entry) => entry.path === editTail[2].path)
  if (repeatedEdit) return { detected: true, attempts: 2, reason: `equivalent edits repeat on ${editTail[2].path}` }
  return { detected: false, attempts: 0 }
}

export function directive(messages: ReadonlyArray<Message>): string | undefined {
  const state = inspect(messages)
  if (!state.detected) return undefined
  const next = Resourcefulness.next(state.attempts)
  return [
    "=== OCX STUCK LOOP ===",
    `Low-information repetition detected: ${state.reason}.`,
    `Resourcefulness level ${next.level}: ${next.action}.`,
    "Do not repeat the same action without new evidence.",
    "=== END OCX STUCK LOOP ===",
  ].join("\n")
}

export * as Stuck from "./stuck"
