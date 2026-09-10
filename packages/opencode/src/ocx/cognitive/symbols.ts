import path from "node:path"
import { existsSync, readFileSync, readdirSync } from "node:fs"

export type SymbolAnchor = {
  readonly file: string
  readonly name: string
  readonly signature: string
}

export function findHeaderFiles(cwd: string, maxHeaders = 10): string[] {
  const candidates: string[] = []
  const searchDirs = ["include", "sys", "hardware", "."]

  for (const dirName of searchDirs) {
    const fullDir = path.resolve(cwd, dirName)
    if (!existsSync(fullDir)) continue
    try {
      const items = readdirSync(fullDir, { recursive: true })
      for (const item of items) {
        if (typeof item === "string" && /\.(?:h|hpp|cuh)$/i.test(item)) {
          candidates.push(path.join(dirName, item))
          if (candidates.length >= maxHeaders) return candidates
        }
      }
    } catch {}
  }

  return candidates
}

export function extractStructDefinitions(filePath: string, cwd: string): SymbolAnchor[] {
  const fullPath = path.resolve(cwd, filePath)
  if (!existsSync(fullPath)) return []

  try {
    const content = readFileSync(fullPath, "utf8")
    const anchors: SymbolAnchor[] = []
    // Match C/C++ struct definitions (e.g. struct foo { ... };)
    const structRegex = /\bstruct\s+([a-zA-Z_]\w*)\s*\{([^}]{1,500})\}\s*;/g
    let match: RegExpExecArray | null

    while ((match = structRegex.exec(content)) !== null) {
      const name = match[1]
      const body = match[2].replace(/\s+/g, " ").trim()
      anchors.push({
        file: filePath,
        name: `struct ${name}`,
        signature: `struct ${name} { ${body.slice(0, 180)}${body.length > 180 ? "..." : ""} };`,
      })
      if (anchors.length >= 4) break
    }

    return anchors
  } catch {
    return []
  }
}

export function groundSymbols(cwd: string, targetFiles: readonly string[]): string | undefined {
  const isSystems = targetFiles.some((f) => /\.(?:c|cc|cpp|cxx|h|hpp|rs)$/i.test(f) || /Android\.bp|Makefile|Kbuild/i.test(f))
  if (!isSystems) return undefined

  const headers = findHeaderFiles(cwd, 6)
  if (headers.length === 0) return undefined

  const anchors: SymbolAnchor[] = []
  for (const header of headers) {
    anchors.push(...extractStructDefinitions(header, cwd))
    if (anchors.length >= 6) break
  }

  if (anchors.length === 0) return undefined

  return [
    "=== IN-TREE GROUND TRUTH SYMBOL ANCHORS ===",
    "Verified in-tree definitions extracted from local headers. Use these exact field names and types:",
    ...anchors.map((a) => `- [${a.file}] ${a.signature}`),
    "Do not guess struct members or kernel APIs; rely on verified in-tree headers.",
    "=== END IN-TREE GROUND TRUTH SYMBOL ANCHORS ===",
  ].join("\n")
}

export * as SymbolRadar from "./symbols"
