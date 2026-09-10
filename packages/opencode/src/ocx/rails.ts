
const TS_LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
}

const transpilers = new Map<string, Bun.Transpiler>()

function transpilerFor(loader: "ts" | "tsx" | "js" | "jsx"): Bun.Transpiler {
  let found = transpilers.get(loader)
  if (!found) {
    found = new Bun.Transpiler({ loader })
    transpilers.set(loader, found)
  }
  return found
}

export function syntaxRail(path: string, content: string): string | undefined {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return undefined
  const loader = TS_LOADERS[path.slice(dot).toLowerCase()]
  if (!loader) return undefined
  try {
    transpilerFor(loader).transformSync(content)
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const firstLine = message.split("\n")[0]?.slice(0, 200) ?? "syntax error"
    return `[ocx rail] syntax error in ${path}: ${firstLine}`
  }
}

export * as Rails from "./rails"
