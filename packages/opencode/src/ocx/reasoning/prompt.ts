import { ReasoningControl, type Input as ReasoningInput, type ReasoningProfile } from "./control"

export type PromptBlock = {
  readonly source: string
  readonly priority: number
  readonly tokens: number
  readonly content: string
}

export function reasoningBlock(input: ReasoningInput): PromptBlock {
  const result = ReasoningControl.block(input)
  return {
    source: "reasoning_control",
    priority: 85,
    tokens: result.tokens,
    content: result.content,
  }
}

export function shouldInject(input: { profile: ReasoningProfile; ocxPipeline: boolean }): boolean {
  if (!input.ocxPipeline) return false
  return true
}

export * as ReasoningPrompt from "./prompt"
