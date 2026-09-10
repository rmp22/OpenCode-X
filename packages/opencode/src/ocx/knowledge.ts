
const CODE = [
  "Model data before logic: settle JSON/state shapes first; most bugs are data-shape bugs.",
  "Functions do one thing at one abstraction level; guard clauses and early returns over nesting; more than three parameters becomes an object.",
  "Errors are values at boundaries: validate and convert at the edges, keep internals typed, one error taxonomy per project.",
  "Prefer deletion: remove dead branches, impossible-state checks, and write-only state instead of working around them.",
  "Tests name behavior: 'returns empty list when input is empty', never test1 or edge-case-2.",
  "Verify a dependency before importing it: read package.json, requirements.txt, or go.mod and prefer what is already installed; never invent package names.",
  "Extract any block you are about to paste a second time into one named function; delete scaffolded methods that nothing calls.",
]

const WEB = [
  "Content sets breakpoints, not devices: resize until layout breaks, fix there, repeat.",
  "Every interactive element is Tab-reachable in reading order with a visible focus ring.",
  "Design tokens first: spacing, type ramp, and color scales as custom properties before components exist.",
  "Images declare width and height, lazy-load below the fold, and carry meaningful alt text (alt=\"\" only for decoration).",
  "Vendor third-party assets into the project: font woff2 from github.com/google/fonts, Material Symbols svg/woff2 from github.com/google/material-design-icons, icon sets, photos. Every external request adds DNS + TLS + render latency and breaks offline.",
  "Marketing surfaces sell the product: the subject must be real photography of it. SVG is for icons, logos, and abstract decoration - never a substitute for product photos.",
  "Interactive markup is semantic: buttons are <button>, images carry alt, inputs carry labels, and <html> carries lang plus a viewport meta.",
]

const FLOW = [
  "Read before write: callers, tests, and adjacent patterns in this repo outrank your prior habits.",
  "Smallest diff that completes the step; when an approach stalls twice, switch approach instead of pushing harder.",
  "Fix the reported defect at its cause; do not regenerate or restructure neighboring working code.",
  "When challenged, recheck against sources before reversing; defend correct work with evidence instead of flipping.",
  "Run arithmetic through code or the shell before printing results; never assert a number you did not execute.",
  "Ground factual claims in sources you opened this turn: quote the line for document claims, and route dates, names, and statistics through tools instead of memory.",
  "Prefer honest unknowns over guesses; a confident error costs more than saying you are not sure.",
  "Match the user's language and register: reply in the script they wrote, mirror their formality, and cut service-bot filler.",
]

const CODE_RULES = [
  "=== OCX CODE RULES ===",
  "For code changes, read the target, callers, and nearby tests before editing.",
  "Do not add comments unless the user explicitly requests them. Preserve required license headers and compiler pragmas.",
  "Use the recorded file plan and keep edits within its ownership boundaries.",
  "Use a real project check before claiming a code task is complete.",
  "=== END OCX CODE RULES ===",
]

const TOPIC_SECTIONS = [
  { terms: ["code", "coding", "implement", "fix", "refactor", "test", "module", "bug", "typescript", "python", "java", "kotlin", "rust", "go", "swift"], lines: CODE },
  { terms: ["web", "browser", "frontend", "ui", "css", "html", "mobile", "responsive", "image", "font", "accessibility"], lines: WEB },
  { terms: ["plan", "research", "review", "verify", "workflow", "check", "evidence", "repo", "repository", "context"], lines: FLOW },
] as const

const MAX_TOPIC_LINES = 4
const MAX_TOPIC_CHARS = 1200

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z][a-z0-9+#-]*/g) ?? [])
}

function safeTopic(value: string): string {
  return value.replace(/\s+/g, " ").replace(/===/g, "").trim().slice(0, 80)
}

export function topicContext(topic: string, request: string): string[] {
  const cleanTopic = safeTopic(topic)
  if (!cleanTopic) return []
  const query = words(`${cleanTopic} ${request}`)
  const selected = TOPIC_SECTIONS.filter((section) => section.terms.some((term) => query.has(term)))
    .flatMap((section) => section.lines.slice(0, 2))
    .slice(0, MAX_TOPIC_LINES)
  const lines = ["=== OCX TOPIC CONTEXT ===", `Topic: ${cleanTopic}`, ...selected.map((line) => `- ${line}`), "=== END OCX TOPIC CONTEXT ==="]
  const bounded: string[] = []
  let size = 0
  for (const line of lines) {
    if (bounded.length > 0 && size + line.length + 1 > MAX_TOPIC_CHARS) break
    bounded.push(line)
    size += line.length + 1
  }
  if (bounded.at(-1) !== "=== END OCX TOPIC CONTEXT ===") bounded.push("=== END OCX TOPIC CONTEXT ===")
  return bounded
}

export function craftKnowledge(): string[] {
  return [
    "=== OCX CRAFT KNOWLEDGE ===",
    ...[...CODE, ...WEB, ...FLOW].map((line) => `- ${line}`),
    "=== END OCX CRAFT KNOWLEDGE ===",
  ]
}

export function codeKnowledge(): string[] {
  return CODE_RULES
}

export * as Knowledge from "./knowledge"
