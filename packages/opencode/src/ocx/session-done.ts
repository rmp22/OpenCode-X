export type Disposition = "working" | "done" | "needs_input" | "blocked" | "cancelled"

const marker = /(?:^(?:<?PHASE>?|VERIFY)[^\n]*?\b|^)STATE:\s*(done|needs_input|blocked|cancelled|canceled|active|working)\b/i

function firstLine(text: string): string {
  return text.trimStart().split(/\r?\n/, 1)[0]?.trim() ?? ""
}

export function disposition(text: string): Disposition {
  const value = marker.exec(firstLine(text))?.[1]?.toLocaleLowerCase()
  if (value === "done" || value === "needs_input") return value
  if (value === "blocked") return "needs_input"
  if (value === "cancelled" || value === "canceled") return "cancelled"
  return "working"
}

export function declaresDone(text: string): boolean {
  return disposition(text) === "done"
}

export function declaresNeedsInput(text: string): boolean {
  return disposition(text) === "needs_input"
}

export function declaresBlocked(text: string): boolean {
  return false
}

export function declaresCancelled(text: string): boolean {
  return disposition(text) === "cancelled"
}

export function terminal(text: string): boolean {
  return disposition(text) !== "working"
}

const stateField = /\bSTATE:\s*(done|needs_input|blocked|cancelled|canceled|active|working)\b/i

export function replaceDisposition(text: string, next: Exclude<Disposition, "working">): string {
  const resolved = (next as string) === "blocked" ? "needs_input" : next
  const line = firstLine(text)
  if (marker.test(line)) return text.replace(line, line.replace(stateField, `STATE: ${resolved}`))
  return `STATE: ${resolved}\n${text}`
}


export * as SessionDone from "./session-done"
