export type PromptPriority = 0 | 1 | 2 | 3 | 4

export interface PromptBlock {
  id: string
  title: string
  priority: PromptPriority
  content: string
  estimatedTokens: number
}

export interface AssembleOptions {
  maxTokens?: number
  safetyBlock?: string
  taskBlock?: string
}

export interface AssembledPrompt {
  fullPrompt: string
  totalTokens: number
  includedBlocks: PromptBlock[]
  omittedBlocks: PromptBlock[]
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

export class NodeContextAssembler {
  private blocks: PromptBlock[] = []

  addBlock(block: { id: string; title: string; priority: PromptPriority; content: string }): void {
    this.blocks.push({
      ...block,
      estimatedTokens: estimateTokenCount(block.content),
    })
  }

  assemble(options?: AssembleOptions): AssembledPrompt {
    const maxTokens = options?.maxTokens ?? 100_000
    const sorted = [...this.blocks].sort((a, b) => a.priority - b.priority)

    let currentTokens = 0
    const includedBlocks: PromptBlock[] = []
    const omittedBlocks: PromptBlock[] = []

    for (const block of sorted) {
      if (currentTokens + block.estimatedTokens <= maxTokens) {
        includedBlocks.push(block)
        currentTokens += block.estimatedTokens
      } else {
        omittedBlocks.push(block)
      }
    }

    includedBlocks.sort((a, b) => a.priority - b.priority)

    let promptParts: string[] = []
    if (options?.safetyBlock) {
      promptParts.push(options.safetyBlock)
    }

    for (const block of includedBlocks) {
      promptParts.push(`=== ${block.title.toUpperCase()} ===\n${block.content}\n=== END ${block.title.toUpperCase()} ===`)
    }

    if (options?.taskBlock) {
      promptParts.push(options.taskBlock)
    }

    return {
      fullPrompt: promptParts.join("\n\n"),
      totalTokens: currentTokens,
      includedBlocks,
      omittedBlocks,
    }
  }

  clear(): void {
    this.blocks = []
  }
}

export const defaultNodeContextAssembler = new NodeContextAssembler()
