import { jsonSchema, tool, type Tool as AITool } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { PracticePacks } from "./practice-packs"

export function createPracticePackTool(): AITool | undefined {
  const packs = PracticePacks.list()
  if (packs.length === 0) return undefined
  const names = packs.map((pack) => pack.name)
  const descriptions = packs.map((pack) => `- ${pack.name}: ${pack.description}`).join("\n") || "none"
  return tool({
    description: `Load source-backed OCX practice for the current task. Available packs:\n${descriptions}`,
    inputSchema: jsonSchema({
      type: "object",
      properties: { name: { type: "string", enum: names, description: "Practice pack name" } },
      required: ["name"],
      additionalProperties: false,
    } as JSONSchema7),
    async execute(args) {
      const name = typeof args.name === "string" ? args.name : ""
      const pack = PracticePacks.load(name)
      if (!pack)
        return {
          output: `Unknown or invalid practice pack "${name}". Available: ${names.join(", ") || "none"}`,
          title: "Practice pack error",
          metadata: { valid: false },
        }
      return { output: PracticePacks.render(pack), title: `Practice: ${pack.name}`, metadata: { valid: true } }
    },
    toModelOutput({ output }) {
      return { type: "text", value: output.output }
    },
  })
}

export * as PracticePackTool from "./practice-pack-tool"
