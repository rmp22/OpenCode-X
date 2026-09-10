export const SURFACE_VALUES = [
  "source_code",
  "identifier",
  "code_comment",
  "documentation",
  "commit_message",
  "pr_description",
  "agent_update",
  "ui_copy",
  "markup",
  "configuration",
  "unknown",
] as const

export type ArtifactSurface = (typeof SURFACE_VALUES)[number]

export type ArtifactInput = {
  readonly path?: string
  readonly kind?: string
}

export function classify(input: ArtifactInput | string): ArtifactSurface {
  if (typeof input === "string") return classifyPath(input)
  if (input.kind && SURFACE_VALUES.includes(input.kind as ArtifactSurface)) return input.kind as ArtifactSurface
  return classifyPath(input.path ?? "")
}

export function classifyPath(value: string): ArtifactSurface {
  const path = value.replaceAll("\\", "/").toLocaleLowerCase()
  const name = path.split("/").at(-1) ?? path
  if (name === "commit" || name === "commit-message") return "commit_message"
  if (name === "pr" || name === "pull-request" || name === "pr-description") return "pr_description"
  if (name === "agent-update" || name === "progress-update") return "agent_update"
  if (name === "ui-copy" || name === "copy") return "ui_copy"
  if (/\.(?:md|mdx|rst|adoc|txt)$/.test(name) || /(?:readme|changelog|contributing)/.test(name)) return "documentation"
  if (/\.(?:html?|css|scss|sass|less)$/.test(name)) return "markup"
  if (/(?:^|\.)(?:json|jsonc|ya?ml|toml|xml|lock)$/.test(name) || /(?:package|tsconfig|bunfig|vite|eslint|prettier)\./.test(name)) return "configuration"
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|kts|swift|c|cc|cpp|h|hpp|sql|sh|bash|zsh)$/.test(name))
    return "source_code"
  return "unknown"
}

export function isSourceSurface(surface: ArtifactSurface): boolean {
  return surface === "source_code" || surface === "identifier" || surface === "code_comment"
}

export function isConfigurationSurface(surface: ArtifactSurface): boolean {
  return surface === "configuration"
}

export function isHumanFacingSurface(surface: ArtifactSurface): boolean {
  return (
    surface === "documentation" ||
    surface === "commit_message" ||
    surface === "pr_description" ||
    surface === "agent_update" ||
    surface === "ui_copy"
  )
}

export { classifyArtifactSurface } from "../operation-classifier"

export * as ArtifactClassifier from "./artifact-classifier"
