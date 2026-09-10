import path from "node:path"
import type { Operation, WorkSurface } from "./workflow"

export type ToolCall = {
  readonly name: string
  readonly input?: unknown
}

export type ClassificationContext = {
  readonly cwd: string
  readonly repositoryRoot?: string
  readonly existingTargets?: ReadonlySet<string>
  readonly userIntent?: string
}

const FILE_KEYS = ["filePath", "filepath", "filename", "file", "path", "target", "targetPath"] as const

export function classifyOperation(toolCall: ToolCall, context: ClassificationContext): Operation | undefined {
  const name = toolCall.name.trim().toLowerCase()
  const targets = targetsFromInput(toolCall.input, context.cwd)
  const surface = targets[0] ? classifyArtifactSurface(targets[0]) : undefined
  if (["read", "glob", "grep", "lsp", "codebase", "context", "ocx_context", "ocx_codebase"].includes(name))
    return { surface: surface ?? "code", action: "inspect", ...(targets.length > 0 ? { targets } : {}), required: false }
  if (["websearch", "webfetch", "youtube-transcript"].includes(name))
    return { surface: "research", action: "inspect", ...(targets.length > 0 ? { targets } : {}), required: false }
  if (name === "audit" || name === "review")
    return { surface: surface ?? "code", action: "review", ...(targets.length > 0 ? { targets } : {}), required: true }
  if (name === "browser") return { surface: "ui", action: "review", ...(targets.length > 0 ? { targets } : {}), required: true }
  if (["write", "write_file", "create_file", "save_file"].includes(name))
    return { surface: surface ?? "code", action: existing(context, targets) ? "edit" : "create", ...(targets.length > 0 ? { targets } : {}), required: true }
  if (["edit", "edit_file", "modify_file", "apply_patch", "patch", "multiedit"].includes(name))
    return { surface: surface ?? "code", action: "edit", ...(targets.length > 0 ? { targets } : {}), required: true }
  if (["shell", "bash", "execute"].includes(name)) return classifyCommand(commandFromInput(toolCall.input), context, targets)
  if (name === "task") return { surface: "environment", action: "run", intent: "delegate work to an owner", required: true }
  if (name === "question") return { surface: "environment", action: "inspect", required: true }
  return undefined
}

export function classifyRequest(request: string): Operation | undefined {
  const text = request.trim().toLocaleLowerCase()
  if (!text) return undefined
  const implementation = countMatches(text, [
    /\b(?:implement|build|refactor|modify|change|fix|delete|remove|generation|generate|produce|scaffold)\b/g,
    /\b(?:add|create|write|edit|update|generate)\s+(?:(?:the|a|an)\s+)?(?:code|source|feature|behavior|test|tests?|component|module|function|patch|workstream|artifact|ui|ux|design|website|webapp)\b/g,
  ])
  const implementationTarget = countMatches(text, [
    /\b(?:code|source|feature|behavior|test|tests?|component|module|function|patch|workstream|artifact|software|ui|ux|design|website|webapp|layout|styling|css|generation)\b/g,
  ])
  const documentation = countMatches(text, [
    /\b(?:docs?|documentation|readme|changelog|guide|report|prose)\b/g,
    /\b(?:write|edit|update|rewrite|add)\s+(?:(?:the|a|an)\s+)?(?:docs?|documentation|readme|changelog|guide|report|prose)\b/g,
  ])
  if (implementationTarget === 0 && /\b(?:fix|debug|diagnose)\b/.test(text)) return undefined
  if (implementation > 0 && /\b(?:ui|ux|design|layout|styling|css|website|webapp|landing page)\b/.test(text))
    return { surface: "ui", action: /\b(?:add|create|implement|build)\b/.test(text) ? "create" : "edit", required: true }
  if (implementation > 0 && implementationTarget > 0)
    return { surface: "code", action: /\b(?:add|create|implement|generate)\b/.test(text) ? "create" : "edit", required: true }
  if (/\b(?:research|investigate|look\s+up|find\s+out|sources?)\b/.test(text) && documentation === 0 && implementation === 0)
    return { surface: "research", action: "inspect", required: true }
  if (/\b(?:review|audit|critique)\b/.test(text)) return { surface: "code", action: "review", required: true }
  if (documentation > 0 && implementation === 0)
    return { surface: "documentation", action: /^(?:docs?|documentation)$/.test(text) || /\b(?:edit|update|rewrite|add|write)\b/.test(text) ? "edit" : "inspect", required: true }
  if (/\b(?:migrate|migration|database|sql|schema)\b/.test(text)) return { surface: "schema", action: "edit", required: true }
  if (/\b(?:commit|stage|push|pull|rebase|git)\b/.test(text)) return { surface: "git", action: /\bcommit\b/.test(text) ? "commit" : "sync", required: true }
  if (/\b(?:test|tests|typecheck|lint|build|benchmark|profile)\b/.test(text))
    return { surface: /\bbuild\b/.test(text) ? "build" : /\b(?:benchmark|profile)\b/.test(text) ? "code" : "test", action: /\b(?:benchmark|profile)\b/.test(text) ? "measure" : "run", required: true }
  if (/\b(?:refactor|rewrite)\b/.test(text)) return { surface: "code", action: "refactor", required: true }
  if (/\b(?:implement|add|create|edit|change|fix|write|delete|remove|code)\b/.test(text))
    return { surface: "code", action: /\b(?:add|create|implement)\b/.test(text) ? "create" : "edit", required: true }
  return undefined
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0)
}

export function classifyArtifactSurface(target: string): WorkSurface {
  const value = target.replaceAll("\\", "/").toLocaleLowerCase()
  const base = value.slice(value.lastIndexOf("/") + 1)
  if (/(?:^|\/)(?:readme|changelog|docs?)(?:[./]|$)|\.(?:md|mdx|txt|adoc)$/.test(value)) return "documentation"
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$/.test(value)) return "test"
  if (/^(?:package\.json|(?:bun|pnpm|yarn|package-lock)\.lock(?:b)?|tsconfig(?:\.[^/]+)?\.json|vite\.config\.|webpack\.config\.)$/.test(base)) return "config"
  if (/^(?:cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|makefile)$/.test(base)) return "build"
  if (/\.(?:sql|graphql|gql|prisma)$/.test(value)) return "schema"
  if (/(?:^|\/)(?:assets?|images?|fonts?)(?:\/|$)|\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/.test(value)) return "ui"
  if (/\.(?:ya?ml|toml|ini|env|conf|config)$/.test(value)) return "config"
  if (/\.(?:csv|jsonl|parquet|sqlite|db)$/.test(value)) return "data"
  if (/(?:^|\/)(?:infra|terraform|k8s|kubernetes)(?:\/|$)/.test(value)) return "environment"
  return "code"
}

function classifyCommand(command: string, context: ClassificationContext, targets: readonly string[]): Operation {
  const text = command.trim().toLocaleLowerCase()
  if (/\bgit\s+(?:status|diff|log|show)\b/.test(text)) return { surface: "git", action: "inspect", required: false }
  if (/\bgit\s+add\b/.test(text)) return { surface: "git", action: "sync", ...(targets.length > 0 ? { targets } : {}), required: true }
  if (/\bgit\s+commit\b/.test(text)) return { surface: "git", action: "commit", required: true }
  if (/\bgit\s+(?:push|pull|fetch|rebase|merge)\b/.test(text)) return { surface: "git", action: "sync", required: true }
  if (/(?:bun|npm|pnpm|yarn|cargo|go|gradle|mvn)\s+(?:test|run\s+(?:test|check|lint|typecheck)|check|lint|fmt)/.test(text))
    return { surface: text.includes("lint") ? "code" : "test", action: "run", required: true }
  if (/(?:typecheck|tsc\b|mypy\b|pyright\b|cargo\s+check)/.test(text)) return { surface: "code", action: "run", required: true }
  if (/(?:build|compile|bundle|vite\s+build|cargo\s+build)/.test(text)) return { surface: "build", action: "run", required: true }
  if (/(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update)|cargo\s+add|go\s+get/.test(text))
    return { surface: "dependency", action: "run", required: true }
  if (/(?:curl|wget|urlretrieve|download|fetch)/.test(text))
    return { surface: targets.some((target) => classifyArtifactSurface(target) === "ui") ? "ui" : "environment", action: "download", ...(targets.length > 0 ? { targets } : {}), required: true }
  if (targets.length > 0 && /(?:>|>>|tee|write|mkdir|touch|cp\b|mv\b|rm\b|sed\s+-i)/.test(text))
    return { surface: classifyArtifactSurface(targets[0]!), action: existing(context, targets) ? "edit" : "create", targets, intent: command, required: true }
  return { surface: "environment", action: "run", intent: command, required: true }
}

function commandFromInput(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return ""
  const record = input as Record<string, unknown>
  return typeof record.command === "string" ? record.command : typeof record.cmd === "string" ? record.cmd : ""
}

function targetsFromInput(input: unknown, cwd: string): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const record = input as Record<string, unknown>
  const values = FILE_KEYS.flatMap((key) => {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return [value.trim()]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    return []
  })
  return [...new Set(values.map((value) => path.isAbsolute(value) ? path.normalize(value) : path.normalize(path.resolve(cwd, value))))]
}

function existing(context: ClassificationContext, targets: readonly string[]): boolean {
  if (targets.length === 0 || !context.existingTargets) return false
  return targets.some((target) => context.existingTargets!.has(target) || context.existingTargets!.has(path.relative(context.repositoryRoot ?? context.cwd, target)))
}

export * as OperationClassifier from "./operation-classifier"
