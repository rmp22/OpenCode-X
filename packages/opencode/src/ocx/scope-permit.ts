import path from "node:path"

export type ScopePermit = {
  readonly roots: readonly string[]
  readonly networkRead: readonly string[]
  readonly expiresTurns: number
  readonly grantedBy: "user-directive" | "human-approval"
}

const DOWNLOAD_SIGNAL = /\b(download|fetch assets?|required resources|external dependencies are allowed)\b/i
const SCOPE_SIGNAL = /\bwork only inside\b/i

function normalizeRoot(value: string, cwd: string): string | undefined {
  const trimmed = value.trim().replace(/^["']|["']$/g, "").replace(/[/\\]+$/, "")
  if (!trimmed) return undefined
  const resolved = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.normalize(path.join(cwd, trimmed))
  return resolved
}

function underRoot(candidate: string, root: string): boolean {
  if (candidate === root) return true
  if (root.includes("<") && root.includes(">")) {
    const escaped = root.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    const regexPattern = "^" + escaped.replace(/<[^>]+>/g, "[^/\\\\]+") + "(?:[/\\\\].*)?$"
    return new RegExp(regexPattern, "i").test(candidate)
  }
  return candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
}

export function mintFromDirectives(directives: readonly string[], cwd: string): ScopePermit | undefined {
  const roots: string[] = []
  for (const directive of directives) {
    if (!SCOPE_SIGNAL.test(directive)) continue
    for (const match of directive.matchAll(/(?:inside:?)\s*["']?([^\s"'`,;]+)["']?/gi)) {
      const root = match[1] ? normalizeRoot(match[1], cwd) : undefined
      if (root && !roots.includes(root)) roots.push(root)
    }
  }
  if (roots.length === 0) return undefined
  const networkRead = directives.some((directive) => DOWNLOAD_SIGNAL.test(directive))
    ? ["images.unsplash.com", "images.pexels.com", "cdn.pixabay.com", "picsum.photos"]
    : []
  return { roots, networkRead, expiresTurns: 50, grantedBy: "user-directive" }
}

export function isPathAllowed(candidate: string, permit: ScopePermit, cwd: string): boolean {
  const resolved = path.isAbsolute(candidate) ? path.normalize(candidate) : path.normalize(path.join(cwd, candidate))
  return permit.roots.some((root) => underRoot(resolved, root))
}

export function isTmpOutput(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, "/")
  return normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized.startsWith("$TMPDIR/")
}

export function redirectTargets(command: string): string[] {
  const targets: string[] = []
  const pattern = /(?:^|[^>|])(>{1,2})\s*("([^"]+)"|'([^']+)'|([^\s;|&]+))/g
  for (const match of command.matchAll(pattern)) {
    const target = (match[3] ?? match[4] ?? match[5] ?? "").trim()
    if (target && target !== "/dev/null") targets.push(target)
  }
  return targets
}

export function hostAllowed(url: string, permit: ScopePermit): boolean {
  const host = /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase()
  if (!host) return false
  return permit.networkRead.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

export * as ScopePermit from "./scope-permit"
