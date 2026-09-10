import type { Finding } from "@/ocx/exit-gate"

const MAX_ESCALATED_FINDINGS = 8

export function message(round: number, findings: readonly Finding[]): string | undefined {
  if (findings.length === 0) return undefined
  const lines = findings.slice(0, MAX_ESCALATED_FINDINGS).map((finding) => `- ${finding.id}: ${finding.message}`)
  return [
    `OCX stopped automatic repair after ${round + 1} rounds.`,
    "User review is required before continuing.",
    "Remaining findings:",
    ...lines,
  ].join("\n")
}

export * as Escalation from "./escalation"
