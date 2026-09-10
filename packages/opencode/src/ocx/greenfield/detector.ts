import path from "node:path"
import type { GreenfieldDetection, GreenfieldPresetType } from "./types"

const BOILERPLATE_NAMES = new Set([
  ".git",
  ".gitignore",
  ".gitattributes",
  "readme.md",
  "readme",
  "readme.txt",
  "license",
  "license.md",
  "license.txt",
  "contributing.md",
  ".github",
  ".editorconfig",
  ".prettierrc",
  ".prettierignore",
])

export function isBoilerplateName(filename: string): boolean {
  const base = path.basename(filename).toLowerCase()
  const match = BOILERPLATE_NAMES.has(base)
  return match
}

export function isBoilerplateOnly(entries: readonly string[]): boolean {
  if (entries.length === 0) return true
  const allBoilerplate = entries.every((e) => isBoilerplateName(e))
  return allBoilerplate
}

export function inferProjectPreset(hint?: string): GreenfieldPresetType {
  if (!hint) return "node-ts"
  const lower = hint.toLowerCase()
  if (lower.includes("cargo") || lower.includes("rust") || lower.endsWith(".rs")) return "rust"
  if (lower.includes("go.mod") || lower.includes("golang") || lower.includes("go")) return "go"
  if (lower.includes("pyproject") || lower.includes("python") || lower.includes("pip") || lower.endsWith(".py")) return "python"
  if (lower.includes("pom.xml") || lower.includes("gradle") || lower.includes("java")) return "java"
  return "node-ts"
}

export async function detectGreenfield(directoryPath: string): Promise<GreenfieldDetection> {
  const checkExists = async (subpath: string) => {
    const file = Bun.file(path.join(directoryPath, subpath))
    const exists = await file.exists()
    return exists
  }

  const hasPackageJson = await checkExists("package.json")
  const hasTsConfig = await checkExists("tsconfig.json")
  const hasTests = (await checkExists("test")) || (await checkExists("tests"))
  const hasSourceRoot = (await checkExists("src")) || (await checkExists("lib"))
  const hasCargo = await checkExists("Cargo.toml")
  const hasGoMod = await checkExists("go.mod")
  const hasPyproject = await checkExists("pyproject.toml")
  const hasPom = await checkExists("pom.xml")

  const hasAnyBuild = hasPackageJson || hasCargo || hasGoMod || hasPyproject || hasPom
  const isGreenfield = !hasAnyBuild || (!hasSourceRoot && !hasTests)

  const detection: GreenfieldDetection = {
    isGreenfield,
    hasPackageJson,
    hasTsConfig,
    hasTests,
    hasSourceRoot,
    totalFiles: (hasPackageJson ? 1 : 0) + (hasTsConfig ? 1 : 0),
  }
  return detection
}
