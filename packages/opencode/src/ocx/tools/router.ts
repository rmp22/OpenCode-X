import { defaultEvidenceStore, type ContentAddressableEvidenceStore } from "../evidence/store"
import type { ToolCapabilityDefinition, TypedToolResult } from "./types"

export class CapabilityRouter {
  private tools = new Map<string, ToolCapabilityDefinition>()
  private evidenceStore: ContentAddressableEvidenceStore

  constructor(store?: ContentAddressableEvidenceStore) {
    this.evidenceStore = store ?? defaultEvidenceStore
  }

  registerTool<TInput, TOutput>(def: ToolCapabilityDefinition<TInput, TOutput>): void {
    this.tools.set(def.name, def as unknown as ToolCapabilityDefinition)
  }

  hasTool(name: string): boolean {
    return this.tools.has(name)
  }

  getTool(name: string): ToolCapabilityDefinition | undefined {
    return this.tools.get(name)
  }

  async execute<TInput, TOutput>(
    name: string,
    input: TInput,
  ): Promise<TypedToolResult<TOutput>> {
    const tool = this.tools.get(name)
    const startTime = Date.now()

    if (!tool) {
      const durationMs = Date.now() - startTime
      const evidence = this.evidenceStore.record(name, input, { error: "Tool not found" })
      return {
        status: "failure",
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool '${name}' is not registered in capability router`,
          recoverable: false,
          recoveryHint: "Check registered tools before invoking",
        },
        evidence,
        telemetry: { durationMs, bytesTransferred: 0 },
      }
    }

    try {
      const output = (await tool.execute(input)) as TOutput
      const durationMs = Date.now() - startTime
      const serialized = JSON.stringify(output)
      const bytesTransferred = serialized ? serialized.length : 0
      const maxBytes = tool.maxOutputBytes ?? 100_000

      let truncated = false
      let continuationToken: string | undefined
      let finalData = output

      if (bytesTransferred > maxBytes) {
        truncated = true
        continuationToken = `token-next-${Date.now()}`
        finalData = (typeof output === "string" ? output.slice(0, maxBytes) : output) as TOutput
      }

      const evidence = this.evidenceStore.record(name, input, finalData)

      return {
        status: truncated ? "partial" : "success",
        data: finalData,
        evidence,
        telemetry: {
          durationMs,
          bytesTransferred,
          linesProcessed: typeof output === "string" ? output.split("\n").length : undefined,
        },
        truncated,
        continuationToken,
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const evidence = this.evidenceStore.record(name, input, { error: String(err) })
      return {
        status: "failure",
        error: {
          code: "EXECUTION_ERROR",
          message: String(err),
          recoverable: true,
          recoveryHint: "Inspect tool error details and retry with valid input",
          rawError: err,
        },
        evidence,
        telemetry: { durationMs, bytesTransferred: 0 },
      }
    }
  }
}

export const defaultCapabilityRouter = new CapabilityRouter()
