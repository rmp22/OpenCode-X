import type { Owner, Scope } from "./registry"
import { toWorkdirRelative } from "./workspace-tree"

export type Input = {
  readonly prompt: string
  readonly paths?: readonly string[]
  readonly symbols?: readonly string[]
}

export type Match = {
  readonly owner: Owner
  readonly score: number
  readonly reasons: readonly string[]
}

export type Domain = {
  readonly name: string
  readonly topic: string
  readonly aliases: readonly string[]
}

const DOMAIN_HINTS: readonly Domain[] = [
  {
    name: "Authentication Owner",
    topic: "authentication",
    aliases: ["auth", "oauth", "login", "token", "tokens", "credential", "credentials", "access"],
  },
  { name: "Networking Owner", topic: "networking", aliases: ["network", "http", "request", "api", "socket"] },
  { name: "Database Owner", topic: "database", aliases: ["database", "sql", "schema", "query", "migration"] },
  { name: "UI Owner", topic: "ui", aliases: ["ui", "view", "component", "render", "screen", "layout", "m3e", "css"] },
  { name: "Build Owner", topic: "build", aliases: ["build", "compile", "package", "bundler", "dependency", "gradle", "cargo", "cmake"] },
  {
    name: "Kernel & Systems Owner",
    topic: "kernel",
    aliases: ["kernel", "driver", "kunit", "sched", "irq", "spinlock", "dma", "vfs", "syscall", "module"],
  },
  {
    name: "Android & AOSP Owner",
    topic: "android",
    aliases: ["android", "aosp", "binder", "aidl", "hidl", "surfaceflinger", "choreographer", "systemserver", "art", "compose"],
  },
  {
    name: "Performance & Tracing Owner",
    topic: "performance",
    aliases: ["perf", "perfetto", "ftrace", "ebpf", "systrace", "benchmark", "profile", "latency", "jank", "fps"],
  },
  {
    name: "Security & Isolation Owner",
    topic: "security",
    aliases: ["security", "selinux", "crypto", "sandbox", "cve", "sanitizer", "audit", "vuln"],
  },
]

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function pathValue(scope: Scope): string {
  return scope.value.replaceAll("\\", "/").replace(/\/\*+$/, "").replace(/\*+$/, "")
}

function pathMatches(scope: Scope, candidate: string): boolean {
  if (scope.type !== "directory" && scope.type !== "file") return false
  const expected = pathValue(scope).toLocaleLowerCase()
  const actual = candidate.replaceAll("\\", "/").toLocaleLowerCase()
  return actual === expected || actual.startsWith(`${expected}/`) || expected.startsWith(`${actual}/`)
}

function ownerWords(owner: Owner): Set<string> {
  return new Set(tokens([owner.name, owner.topic, owner.description, ...owner.scopes.map((scope) => scope.value)].join(" ")))
}

function domainScore(domain: Domain, input: Input): number {
  const words = new Set(tokens([input.prompt, ...(input.paths ?? []), ...(input.symbols ?? [])].join(" ")))
  return [domain.topic, ...domain.aliases].reduce((score, word) => score + (words.has(word) ? 1 : 0), 0)
}

export function domains(input: Input): Domain[] {
  const ranked = DOMAIN_HINTS.map((domain) => ({ domain, score: domainScore(domain, input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.domain.topic.localeCompare(b.domain.topic))
    .slice(0, 3)
    .map((item) => item.domain)
  if (ranked.length > 0) return ranked

  const path = input.paths?.find(Boolean)
  if (path) {
    const norm = toWorkdirRelative(process.cwd(), path)
    const parts = norm.split("/").filter(Boolean)
    const invalidRoots = new Set(["mnt", "home", "Users", "root", "var", "tmp"])
    const filtered = parts.filter((p) => !invalidRoots.has(p))
    const segment = filtered.length > 1 && (filtered[0] === "packages" || filtered[0] === "services" || filtered[0] === "apps")
      ? `${filtered[0]}/${filtered[1]}`
      : filtered[0]
    if (segment) return [{ name: `${segment} Owner`, topic: segment, aliases: [] }]
  }
  return [{ name: "Repository Owner", topic: "repository", aliases: ["repository", "codebase"] }]
}

export function score(owner: Owner, input: Input): Match {
  const words = ownerWords(owner)
  const reasons: string[] = []
  let value = 0
  for (const token of tokens([input.prompt, ...(input.symbols ?? [])].join(" "))) {
    if (!words.has(token)) continue
    value += 2
    if (!reasons.includes(`topic token: ${token}`)) reasons.push(`topic token: ${token}`)
  }
  for (const path of input.paths ?? []) {
    for (const scope of owner.scopes) {
      if (!pathMatches(scope, path)) continue
      value += 8 + scope.priority
      reasons.push(`${scope.type} match: ${scope.value}`)
    }
  }
  if (tokens(owner.topic).some((token) => tokens(input.prompt).includes(token))) {
    value += 4
    reasons.push("topic match")
  }
  return { owner, score: value, reasons: [...new Set(reasons)] }
}

export function rank(owners: readonly Owner[], input: Input): Match[] {
  return owners
    .filter((owner) => owner.status === "available" || owner.status === "busy")
    .map((owner) => score(owner, input))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.owner.confidence - a.owner.confidence || a.owner.id.localeCompare(b.owner.id))
}

export function scopes(domain: Domain, paths: readonly string[] = []): Scope[] {
  const result: Scope[] = [
    { type: "subsystem", value: domain.topic, priority: 8 },
    { type: "topic", value: domain.topic, priority: 7 },
    ...domain.aliases.map((value) => ({ type: "topic" as const, value, priority: 4 })),
  ]
  for (const path of paths.slice(0, 3)) result.push({ type: "directory", value: path, priority: 6 })
  return result
}

export * as OwnerRouter from "./router"
