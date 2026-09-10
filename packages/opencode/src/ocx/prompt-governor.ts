export type InjectorSource =
  | "core"
  | "hard_constraint"
  | "execution_plan"
  | "current_step"
  | "playbook"
  | "evidence"
  | "recovery"
  | "optional_knowledge"
  | "workflow"
  | "strategies"
  | "todo"
  | "requirements"
  | "context"
  | "platform_knowledge"
  | "craft_knowledge"
  | "code_rules"
  | "practice_packs"
  | "progress"
  | "reasoning_feedback"
  | "recovery_guidance"
  | "reasoning_control"

export type PromptBlock = {
  readonly id?: string
  readonly source: InjectorSource
  readonly priority?: number
  readonly tokens: number
  readonly content: string
  readonly trimPolicy?: "never" | "bounded" | "optional"
  readonly reasonAdmitted?: string
  readonly reuseId?: string
}

export type GovernorResult = {
  readonly admitted: PromptBlock[]
  readonly rejected: PromptBlock[]
  readonly deduplicated: PromptBlock[]
  readonly totalRequested: number
  readonly totalAdmitted: number
  readonly totalRejected: number
  readonly metrics: Record<string, { requested: number; admitted: number }>
}

const PRIORITY: Record<InjectorSource, number> = {
  hard_constraint: 110,
  requirements: 100,
  workflow: 90,
  current_step: 95,
  execution_plan: 85,
  playbook: 84,
  core: 80,
  recovery_guidance: 85,
  recovery: 85,
  progress: 70,
  evidence: 65,
  context: 60,
  optional_knowledge: 15,
  practice_packs: 30,
  reasoning_feedback: 25,
  platform_knowledge: 20,
  craft_knowledge: 15,
  code_rules: 15,
  strategies: 10,
  todo: 50,
  reasoning_control: 105,
}

export function priorityFor(source: InjectorSource): number {
  return PRIORITY[source] ?? 0
}

export class PromptGovernor {
  private readonly budget: number
  private admittedTokens = 0
  private readonly seen = new Set<string>()

  constructor(budget: number = 8000) {
    this.budget = budget
  }

  govern(blocks: PromptBlock[]): GovernorResult {
    const sorted = [...blocks].sort(
      (a, b) => (b.priority ?? priorityFor(b.source)) - (a.priority ?? priorityFor(a.source)),
    )
    const admitted: PromptBlock[] = []
    const rejected: PromptBlock[] = []
    const deduplicated: PromptBlock[] = []
    const metrics: Record<string, { requested: number; admitted: number }> = {}

    let playbookAdmitted = false
    for (const block of sorted) {
      const key = block.id ?? block.reuseId ?? `${block.source}:${block.content}`
      if (this.seen.has(key)) {
        deduplicated.push(block)
        continue
      }
      this.seen.add(key)

      const sourceMetrics = metrics[block.source] ?? { requested: 0, admitted: 0 }
      sourceMetrics.requested += block.tokens
      metrics[block.source] = sourceMetrics

      if (block.source === "playbook" && playbookAdmitted) {
        rejected.push(block)
        continue
      }
      const required = block.trimPolicy === "never" || ["hard_constraint", "current_step", "reasoning_control"].includes(block.source)
      if (required || this.admittedTokens + block.tokens <= this.budget) {
        admitted.push({ ...block, reasonAdmitted: `priority ${block.priority ?? priorityFor(block.source)}` })
        this.admittedTokens += block.tokens
        sourceMetrics.admitted += block.tokens
        if (block.source === "playbook") playbookAdmitted = true
      } else {
        rejected.push(block)
      }
    }

    return {
      admitted,
      rejected,
      deduplicated,
      totalRequested: blocks.reduce((s, b) => s + b.tokens, 0),
      totalAdmitted: this.admittedTokens,
      totalRejected: blocks.reduce((s, b) => s + b.tokens, 0) - this.admittedTokens,
      metrics,
    }
  }

  reset(): void {
    this.admittedTokens = 0
    this.seen.clear()
  }

  get admittedTokensCount(): number {
    return this.admittedTokens
  }
}

export function deduplicateBlocks(blocks: PromptBlock[]): { unique: PromptBlock[]; duplicates: number } {
  const seen = new Set<string>()
  const unique: PromptBlock[] = []
  let duplicates = 0
  for (const block of blocks) {
    const key = block.content.trim().slice(0, 200)
    if (seen.has(key)) duplicates++
    else {
      seen.add(key)
      unique.push(block)
    }
  }
  return { unique, duplicates }
}

export function metricsReport(result: GovernorResult): string {
  return Object.entries(result.metrics)
    .map(([source, m]) => `${source}: ${m.admitted}/${m.requested}`)
    .join("\n")
}

export * as PromptGovernorModule from "./prompt-governor"
