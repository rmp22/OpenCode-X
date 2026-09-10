export type DependencyFinding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

const IMPORT_PATTERN = /\b(?:from|import|require)\s*(?:\(\s*)?["']([^"']+)["']/g
const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i
const MANIFEST_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const
const BUILTIN_MODULES = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
])

type Manifest = {
  readonly names: ReadonlySet<string>
  readonly valid: boolean
}

function manifestNames(text: string): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { names: new Set(), valid: false }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { names: new Set(), valid: false }
  const record = value as Record<string, unknown>
  const names = new Set<string>()
  if (typeof record.name === "string") names.add(record.name)
  for (const section of MANIFEST_SECTIONS) {
    const entries = record[section]
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue
    for (const name of Object.keys(entries)) names.add(name)
  }
  return { names, valid: true }
}

function packageName(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:")
  )
    return undefined
  const root = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]
  return BUILTIN_MODULES.has(root) ? undefined : root
}

export function dependencyFindings(
  added: ReadonlyMap<string, readonly string[]> | undefined,
  manifestText: string | undefined,
): DependencyFinding[] {
  if (!added || added.size === 0 || manifestText === undefined) return []
  const manifest = manifestNames(manifestText)
  if (!manifest.valid)
    return [{ id: "C25-invalid-manifest", message: "package manifest could not be parsed; verify dependencies before importing new packages" }]

  const findings: DependencyFinding[] = []
  const seen = new Set<string>()
  for (const [path, lines] of added) {
    if (!CODE_FILE.test(path)) continue
    for (const line of lines) {
      for (const match of line.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1]
        const name = packageName(specifier)
        if (!name || manifest.names.has(name) || seen.has(name)) continue
        seen.add(name)
        findings.push({
          id: "C26-unlisted-dependency",
          message: `added import "${specifier}" is absent from the project manifest; verify the package before importing it`,
          span: `${path}: ${specifier}`,
        })
        if (findings.length >= 3) return findings
      }
    }
  }
  return findings
}

export * as DependencyGate from "./dependency-gate"
