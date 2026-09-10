import type { OperationCategory } from "./types"

const TOOL_CLASSIFICATIONS: Record<string, OperationCategory> = {
  read: "read",
  glob: "read",
  grep: "read",
  websearch: "read",
  ocx_context: "read",
  ocx_codebase: "read",
  ocx_session: "read",
  "youtube-transcript": "read",

  write: "mutate",
  edit: "mutate",

  bash: "execute",

  webfetch: "external",
  ocx_asset: "external",
  ocx_render: "external",

  todowrite: "administrative",
  ocx_header: "administrative",
  ocx_plan: "administrative",
  question: "administrative",
  skill: "administrative",
  task: "administrative",
}

export function classifyTool(toolName: string): OperationCategory {
  const normalized = toolName.toLowerCase()
  const category = TOOL_CLASSIFICATIONS[normalized]
  if (category) return category
  if (normalized.startsWith("read_") || normalized.includes("search") || normalized.includes("get")) {
    return "read"
  }
  if (normalized.startsWith("write_") || normalized.includes("edit") || normalized.includes("update") || normalized.includes("patch")) {
    return "mutate"
  }
  if (normalized.includes("exec") || normalized.includes("run") || normalized.includes("cmd")) {
    return "execute"
  }
  if (normalized.includes("fetch") || normalized.includes("download") || normalized.includes("http")) {
    return "external"
  }
  return "mutate"
}

export function isKnownTool(toolName: string): boolean {
  return toolName.toLowerCase() in TOOL_CLASSIFICATIONS
}

export * as PolicyClassification from "./classification"
