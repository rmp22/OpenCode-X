import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { LLM } from "@/session/llm"
import type { Provider } from "@/provider/provider"
import type { Finding } from "./exit-gate"

export type VerifierDeps = {
  readonly llm: LLM.Interface
  readonly user: SessionV1.User
  readonly model: Provider.Model
  readonly sessionID: string
}

export type VerifierInput = {
  readonly reply: string
  readonly files: readonly { path: string; content: string }[]
  readonly candidates: readonly Finding[]
}

const maxCandidates = 8
const maxFileChars = 8000
const maxTotalFileChars = 24000

const RUBRIC = `You verify flagged output candidates. For each candidate decide whether the quoted span really is a problem in its surrounding context.
Rules:
- Confirm only what the quoted span itself proves. Do not guess about code you cannot see.
- Quote the exact span back. A quote that does not match the artifact is an automatic reject.
- Reject candidates that quote normal, justified content (user-quoted text, sample data clearly labeled, deliberate examples).
Output JSON only. Do not think step by step. Reply immediately with:
{"verdicts":[{"index":0,"confirmed":true,"quote":"exact span","reason":"short"}]}`

const section = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`

function parseJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function buildMessage(input: VerifierInput): string {
  const candidates = input.candidates.slice(0, maxCandidates)
  const files: string[] = []
  let budget = maxTotalFileChars
  for (const file of input.files.slice(0, 6)) {
    if (budget <= 0) break
    const content = file.content.slice(0, Math.min(maxFileChars, budget))
    budget -= content.length
    files.push(section(file.path, content))
  }
  const listed = candidates.map((candidate, index) => `${index}. [${candidate.id}] quote: "${candidate.span ?? ""}" - ${candidate.message}`)
  return [
    section("rubric", RUBRIC),
    section("candidates", listed.join("\n") || "none"),
    section("reply", input.reply.slice(0, 8000)),
    ...files,
  ].join("\n\n")
}

function confirmedFindings(
  parsed: Record<string, unknown> | undefined,
  candidates: readonly Finding[],
  haystacks: readonly string[],
): Finding[] {
  if (!parsed || !Array.isArray(parsed.verdicts)) return []
  const out: Finding[] = []
  for (const raw of parsed.verdicts) {
    if (!raw || typeof raw !== "object") continue
    const verdict = raw as Record<string, unknown>
    if (verdict.confirmed !== true) continue
    const index = typeof verdict.index === "number" ? verdict.index : -1
    const candidate = candidates[index]
    if (!candidate) continue
    const quote = typeof verdict.quote === "string" ? verdict.quote.trim() : ""
    if (!quote) continue
    const exists =
      haystacks.some((haystack) => haystack.includes(quote)) ||
      candidates.some((other) => other.span === quote)
    if (!exists) continue
    const reason = typeof verdict.reason === "string" ? verdict.reason.slice(0, 200) : ""
    out.push({
      id: `V-${candidate.id.replace(/^A-/, "")}`,
      message: `verified: ${candidate.message}${reason ? ` - ${reason}` : ""}`,
      span: quote,
    })
  }
  return out
}

export const verify = Effect.fn("OCXVerifier.verify")(function* (
  deps: VerifierDeps,
  input: VerifierInput,
) {
  if (input.candidates.length === 0) return []
  const candidates = input.candidates.slice(0, maxCandidates)
  const haystacks = [input.reply, ...input.files.map((file) => file.content)]
  const message = buildMessage(input)

  const call = (extra: string | undefined) =>
    deps.llm
      .stream({
        user: deps.user,
        sessionID: deps.sessionID,
        model: deps.model,
        agent: {
          name: "ocx-verifier",
          mode: "primary" as const,
          hidden: true,
          native: true,
          temperature: 0.1,
          permission: [],
          options: {},
          prompt: "",
        },
        system: [],
        messages: [{ role: "user" as const, content: extra ? `${message}\n\n${extra}` : message }],
        tools: {},
        retries: 1,
      })
      .pipe(
        Stream.filter(LLMEvent.is.textDelta),
        Stream.map((event) => event.text),
        Stream.mkString,
      )

  const formatError = section(
    "format_error",
    "The previous reply was not valid JSON. Reply again with ONLY the verdict JSON object.",
  )

  const first = yield* call(undefined).pipe(Effect.catch(() => Effect.succeed("")))
  const parsedFirst = parseJson(first)
  if (parsedFirst) return confirmedFindings(parsedFirst, candidates, haystacks)
  const second = yield* call(formatError).pipe(Effect.catch(() => Effect.succeed("")))
  return confirmedFindings(parseJson(second), candidates, haystacks)
})

export * as Verifier from "./verifier"
