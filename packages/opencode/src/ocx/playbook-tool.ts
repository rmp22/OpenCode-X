import { tool, jsonSchema, type Tool as AITool } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Strategy } from "@/ocx/strategy"
import { CORE_STRATEGIES } from "./heuristics"

const DESCRIPTION = `Load an OCX playbook: detailed rules for one specialty.
Pull it when the task matches a trigger:
- ui / web-design / fonts / browser: any screen, page, styling, or rendered-check work
- web: security-sensitive work (auth, input handling, CORS)
- think: math, comparisons, estimates, hard judgment calls
- reasoning: debugging or root-cause work
- frontend + stack adapters: deep frontend or language-specific work
- audit / review / complexity: reviewing or simplifying changes
Returns the full playbook text. Load at most the ones the task needs.`

export function createPlaybookTool(): AITool {
  const names = [...Strategy.STRATEGY_NAMES]
  return tool({
    description: DESCRIPTION,
    inputSchema: jsonSchema({
      type: "object",
      properties: { name: { type: "string", enum: names, description: "Playbook name from the list" } },
      required: ["name"],
      additionalProperties: false,
    } as never as JSONSchema7),
    async execute(args) {
      const name = (args as { name?: string }).name ?? ""
      const content = Strategy.load(name)?.trim()
      if (!content)
        return {
          output: `Unknown playbook "${name}". Available: ${names.join(", ")}`,
          title: "Playbook error",
          metadata: { valid: false },
        }
      return { output: content, title: `Playbook: ${name}`, metadata: { valid: true } }
    },
    toModelOutput({ output }) {
      return { type: "text", value: output.output }
    },
  })
}

export * as PlaybookTool from "./playbook-tool"
