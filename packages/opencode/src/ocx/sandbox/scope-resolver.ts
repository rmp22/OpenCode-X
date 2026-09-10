import path from "node:path"

export interface ScopePermit {
  readonly roots: readonly string[]
  readonly networkAllowed: readonly string[]
  readonly grantedBy: "user-directive" | "plan-target" | "default"
}

export function expandVariables(template: string, env: Record<string, string>): string {
  let expanded = template
  for (const [key, value] of Object.entries(env)) {
    expanded = expanded.replaceAll(`$${key}`, value).replaceAll(`\${${key}}`, value)
  }
  return expanded
}

export function isPathInScope(candidate: string, roots: readonly string[], cwd: string): boolean {
  if (roots.length === 0) return true
  const resolved = path.isAbsolute(candidate) ? path.normalize(candidate) : path.normalize(path.join(cwd, candidate))

  return roots.some((root) => {
    if (root.includes("<") && root.includes(">")) {
      const escaped = root.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      const pattern = "^" + escaped.replace(/<[^>]+>/g, "[^/\\\\]+") + "(?:[/\\\\].*)?$"
      return new RegExp(pattern, "i").test(resolved)
    }
    const resolvedRoot = path.isAbsolute(root) ? path.normalize(root) : path.normalize(path.join(cwd, root))
    if (resolved === resolvedRoot) return true
    return resolved.startsWith(resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`)
  })
}

export function resolvePermit(input: {
  readonly directives: readonly string[]
  readonly cwd: string
  readonly env?: Record<string, string>
}): ScopePermit {
  const roots: string[] = []
  const env = input.env ?? {}

  for (const directive of input.directives) {
    const expanded = expandVariables(directive, env)
    for (const match of expanded.matchAll(/(?:inside:?)\s*["']?([^\s"'`,;]+)["']?/gi)) {
      const candidate = match[1]
      if (candidate) roots.push(candidate)
    }
  }

  const networkAllowed = [
    "images.unsplash.com",
    "images.pexels.com",
    "cdn.pixabay.com",
    "picsum.photos",
    "registry.npmjs.org",
    "crates.io",
    "pypi.org",
  ]

  return {
    roots: [...new Set(roots)],
    networkAllowed,
    grantedBy: roots.length > 0 ? "user-directive" : "default",
  }
}

export * as ScopeResolver from "./scope-resolver"
