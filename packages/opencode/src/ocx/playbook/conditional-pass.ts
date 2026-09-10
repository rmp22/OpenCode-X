export interface PlaybookTriggerContext {
  readonly requestText: string
  readonly activeFiles?: readonly string[]
  readonly stage: string
}

export type PlaybookName = "ui" | "web" | "think" | "reasoning" | "frontend" | "audit" | "structure"

const PLAYBOOK_TRIGGERS: Record<PlaybookName, RegExp> = {
  ui: /\b(landing page|ui|ux|design|css|layout|hero|typography|fonts?|color|aesthetic|responsive)\b/i,
  web: /\b(auth|session|cookie|cors|csrf|token|endpoint|http|api|header|security)\b/i,
  think: /\b(benchmark|estimate|calculate|trade-off|compare|complex|proof)\b/i,
  reasoning: /\b(debug|root cause|reproduce|isolate|diagnose|fix bug|trace)\b/i,
  frontend: /\b(react|vue|svelte|component|props|state|hook|dom|hydration)\b/i,
  audit: /\b(review|audit|critique|check code|inspect changes)\b/i,
  structure: /\b(refactor|modularize|clean code|anti-slop|simplify|architecture)\b/i,
}

export function shouldRunPlaybookPass(context: PlaybookTriggerContext): {
  readonly run: boolean
  readonly matchedPlaybooks: readonly PlaybookName[]
} {
  const matched: PlaybookName[] = []
  const text = context.requestText

  for (const [name, regex] of Object.entries(PLAYBOOK_TRIGGERS) as [PlaybookName, RegExp][]) {
    if (regex.test(text)) {
      matched.push(name)
    }
  }

  return {
    run: matched.length > 0,
    matchedPlaybooks: matched,
  }
}

export * as ConditionalPlaybookPass from "./conditional-pass"
