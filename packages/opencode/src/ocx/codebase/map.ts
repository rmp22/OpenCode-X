import path from "node:path"
import { classifyPath, relativePath } from "./profile"
import type { ModuleRecord, RepositoryMap } from "./types"

export type MapInput = {
  readonly root: string
  readonly paths: readonly string[]
  readonly buildFiles?: Readonly<Record<string, string>>
  readonly buildSystems?: readonly string[]
  readonly fingerprints?: readonly string[]
  readonly now?: number
}

type Candidate = {
  readonly path: string
  readonly type: string
  readonly buildFile?: string
  readonly buildSystem?: string
}

const BUILD_FILE_SYSTEMS: Record<string, string> = {
  BUILD: "Bazel",
  "BUILD.bazel": "Bazel",
  "MODULE.bazel": "Bazel",
  WORKSPACE: "Bazel",
  "CMakeLists.txt": "CMake",
  "build.gradle": "Gradle",
  "build.gradle.kts": "Gradle",
  "Cargo.toml": "Cargo",
  "go.mod": "Go",
  "go.work": "Go",
  "package.json": "Node",
  "pom.xml": "Maven",
}

export function discoverMap(input: MapInput): RepositoryMap {
  const paths = unique(input.paths.map((item) => relativePath(input.root, item)))
  const contents = normalizeContents(input.root, input.buildFiles ?? {})
  const candidates = new Map<string, Candidate>()
  addCandidate(candidates, { path: ".", type: "repository" })

  for (const filepath of paths) {
    const directory = path.posix.dirname(filepath)
    const basename = path.posix.basename(filepath)
    const system = BUILD_FILE_SYSTEMS[basename]
    if (system)
      addCandidate(candidates, {
        path: directory,
        type: system.toLowerCase(),
        buildFile: filepath,
        buildSystem: system,
      })
    if (/\.(?:sln|csproj)$/i.test(basename))
      addCandidate(candidates, { path: directory, type: "dotnet", buildFile: filepath, buildSystem: ".NET" })
  }

  for (const [filepath, content] of Object.entries(contents)) {
    const directory = path.posix.dirname(filepath)
    const basename = path.posix.basename(filepath)
    const system = BUILD_FILE_SYSTEMS[basename]
    if (basename === "package.json") addNodeCandidates(candidates, directory, content, paths)
    if (basename === "Cargo.toml")
      addPatternCandidates(candidates, directory, content, "cargo", paths, /\bmembers\s*=\s*\[([\s\S]*?)\]/m)
    if (basename === "settings.gradle" || basename === "settings.gradle.kts")
      addGradleCandidates(candidates, directory, content)
    if (basename === "pom.xml") addXmlCandidates(candidates, directory, content, "maven", "module")
    if (basename === "go.work") addGoCandidates(candidates, directory, content, paths)
    if (basename === "CMakeLists.txt") addCmakeCandidates(candidates, directory, content)
    if (system === "Bazel")
      addCandidate(candidates, { path: directory, type: "bazel", buildFile: filepath, buildSystem: system })
  }

  addGenericCandidates(candidates, paths)
  const modules = [...candidates.values()]
    .map((candidate) => createModule(candidate, candidates, paths, input.root, input.buildSystems ?? []))
    .toSorted((a, b) => a.path.localeCompare(b.path))
  const sourceRoots = roots(paths, "SOURCE")
  const testRoots = roots(paths, "TEST")
  const generatedRoots = roots(paths, "GENERATED").filter((root) => !sourceRoots.includes(root))
  const dependencyRoots = roots(paths, "DEPENDENCY", "VENDOR").filter((root) => !sourceRoots.includes(root))
  return {
    version: 1,
    root: path.resolve(input.root),
    modules,
    buildFiles: Object.keys(contents).sort(),
    sourceRoots,
    testRoots,
    generatedRoots,
    dependencyRoots,
    fingerprints: [...(input.fingerprints ?? [])],
    updatedAt: input.now ?? Date.now(),
  }
}

export function moduleForPath(map: RepositoryMap, filepath: string): ModuleRecord | undefined {
  const value = path.isAbsolute(filepath)
    ? relativePath(map.root, filepath)
    : filepath.replaceAll("\\", "/").replace(/^\.\//, "")
  if (value === ".." || value.startsWith("../")) return undefined
  return map.modules
    .filter((item) => item.path === "." || value === item.path || value.startsWith(`${item.path}/`))
    .toSorted((a, b) => b.path.length - a.path.length)[0]
}

export function relatedModules(map: RepositoryMap, modulePathOrName: string): ModuleRecord[] {
  const current = map.modules.find(
    (item) => item.path === modulePathOrName || item.name === modulePathOrName || item.id === modulePathOrName,
  )
  if (!current) return []
  const parent = current.parentModuleID
  return map.modules
    .filter(
      (item) =>
        item.id !== current.id &&
        (item.parentModuleID === parent || item.parentModuleID === current.id || item.id === parent),
    )
    .toSorted((a, b) => a.path.localeCompare(b.path))
}

function createModule(
  candidate: Candidate,
  candidates: ReadonlyMap<string, Candidate>,
  paths: readonly string[],
  root: string,
  systems: readonly string[],
): ModuleRecord {
  const parent = [...candidates.keys()]
    .filter((item) => item !== candidate.path && item !== "." && candidate.path.startsWith(`${item}/`))
    .toSorted((a, b) => b.length - a.length)[0]
  const relativeFiles = paths.flatMap((filepath) => {
    if (candidate.path === ".") return [filepath]
    if (filepath === candidate.path || filepath.startsWith(`${candidate.path}/`))
      return [filepath.slice(candidate.path.length + 1)]
    return []
  })
  return {
    id: candidate.path === "." ? "root" : `module:${candidate.path}`,
    name: candidate.path === "." ? path.basename(path.resolve(root)) : path.posix.basename(candidate.path),
    path: candidate.path,
    type: candidate.type,
    ...(parent ? { parentModuleID: parent === "." ? "root" : `module:${parent}` } : {}),
    ...(candidate.buildSystem
      ? { buildSystem: candidate.buildSystem }
      : systems[0] && candidate.path === "."
        ? { buildSystem: systems[0] }
        : {}),
    ...(candidate.buildFile ? { buildFile: candidate.buildFile } : {}),
    sourceRoots: localRoots(relativeFiles, "SOURCE"),
    testRoots: localRoots(relativeFiles, "TEST"),
    generatedRoots: localRoots(relativeFiles, "GENERATED"),
    dependencyRoots: localRoots(relativeFiles, "DEPENDENCY", "VENDOR"),
  }
}

function addNodeCandidates(
  candidates: Map<string, Candidate>,
  directory: string,
  content: string,
  paths: readonly string[],
) {
  addCandidate(candidates, {
    path: directory,
    type: "node",
    buildFile: path.posix.join(directory, "package.json"),
    buildSystem: "Node",
  })
  const data = json(content)
  const workspaceValue = data?.workspaces
  const workspaceRecord =
    workspaceValue && typeof workspaceValue === "object" && !Array.isArray(workspaceValue)
      ? (workspaceValue as Record<string, unknown>)
      : undefined
  const workspaces = Array.isArray(workspaceValue)
    ? workspaceValue.filter((item): item is string => typeof item === "string")
    : Array.isArray(workspaceRecord?.packages)
      ? workspaceRecord.packages.filter((item): item is string => typeof item === "string")
      : []
  for (const pattern of workspaces) {
    for (const directoryPath of directories(paths)) {
      if (!globMatch(pattern, directoryPath)) continue
      addCandidate(candidates, { path: directoryPath, type: "node", buildSystem: "Node" })
    }
  }
}

function addPatternCandidates(
  candidates: Map<string, Candidate>,
  directory: string,
  content: string,
  type: string,
  paths: readonly string[],
  expression: RegExp,
) {
  const match = content.match(expression)
  if (!match) return
  for (const pattern of quoted(match[1])) {
    for (const directoryPath of directories(paths)) {
      if (!globMatch(path.posix.join(directory, pattern), directoryPath)) continue
      addCandidate(candidates, { path: directoryPath, type, buildSystem: type === "cargo" ? "Cargo" : undefined })
    }
  }
}

function addGradleCandidates(candidates: Map<string, Candidate>, directory: string, content: string) {
  const matches = [...content.matchAll(/(?:include|includeBuild)\s*(?:\(|\s)\s*([^\n)]*)/g)]
  for (const match of matches) {
    for (const value of quoted(match[1])) {
      const modulePath = value.replace(/^:/, "").replaceAll(":", "/")
      addCandidate(candidates, { path: path.posix.join(directory, modulePath), type: "gradle", buildSystem: "Gradle" })
    }
  }
}

function addXmlCandidates(
  candidates: Map<string, Candidate>,
  directory: string,
  content: string,
  type: string,
  tag: string,
) {
  const expression = new RegExp(`<${tag}>([^<]+)</${tag}>`, "gi")
  for (const match of content.matchAll(expression)) {
    addCandidate(candidates, { path: path.posix.join(directory, match[1].trim()), type, buildSystem: "Maven" })
  }
}

function addGoCandidates(
  candidates: Map<string, Candidate>,
  directory: string,
  content: string,
  paths: readonly string[],
) {
  for (const match of content.matchAll(/^\s*use\s+(.+)$/gm)) {
    const value = match[1].trim().replace(/^['"]|['"]$/g, "")
    if (value.startsWith("(")) continue
    const target = path.posix.normalize(path.posix.join(directory, value.replace(/^\.\//, "")))
    if (directories(paths).includes(target)) addCandidate(candidates, { path: target, type: "go", buildSystem: "Go" })
  }
}

function addCmakeCandidates(candidates: Map<string, Candidate>, directory: string, content: string) {
  for (const match of content.matchAll(/add_subdirectory\s*\(\s*([^\s)]+)/gi))
    addCandidate(candidates, { path: path.posix.join(directory, match[1]), type: "cmake", buildSystem: "CMake" })
}

function addGenericCandidates(candidates: Map<string, Candidate>, paths: readonly string[]) {
  for (const directory of directories(paths)) {
    const children = paths.flatMap((filepath) => {
      const relative =
        directory === "." ? filepath : filepath.startsWith(`${directory}/`) ? filepath.slice(directory.length + 1) : ""
      return relative && relative.includes("/") ? [relative.split("/")[0]] : []
    })
    if (
      children.some(
        (item) => item === "src" || item === "test" || item === "tests" || item === "lib" || item === "include",
      )
    )
      addCandidate(candidates, { path: directory, type: "directory" })
  }
}

function addCandidate(candidates: Map<string, Candidate>, candidate: Candidate) {
  const pathValue = candidate.path.replaceAll("\\", "/").replace(/^\.\//, "") || "."
  const existing = candidates.get(pathValue)
  if (!existing) {
    candidates.set(pathValue, { ...candidate, path: pathValue })
    return
  }
  candidates.set(pathValue, {
    path: pathValue,
    type: existing.type === "directory" ? candidate.type : existing.type,
    ...((candidate.buildFile ?? existing.buildFile) ? { buildFile: candidate.buildFile ?? existing.buildFile } : {}),
    ...((candidate.buildSystem ?? existing.buildSystem)
      ? { buildSystem: candidate.buildSystem ?? existing.buildSystem }
      : {}),
  })
}

function normalizeContents(root: string, contents: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(contents).map(([filepath, content]) => [relativePath(root, filepath), content]),
  )
}

function directories(paths: readonly string[]): string[] {
  const result = new Set<string>(["."])
  for (const filepath of paths) {
    const parts = filepath.split("/")
    for (let index = 1; index < parts.length; index++) result.add(parts.slice(0, index).join("/"))
  }
  return [...result]
}

function roots(paths: readonly string[], ...classes: string[]): string[] {
  const wanted = new Set(classes)
  return [
    ...new Set(
      paths.flatMap((filepath) =>
        wanted.has(classifyPath(filepath)) && filepath.includes("/") ? [filepath.split("/")[0]] : [],
      ),
    ),
  ]
    .filter(Boolean)
    .sort()
}

function localRoots(paths: readonly string[], ...classes: string[]): string[] {
  const wanted = new Set(classes)
  return [
    ...new Set(
      paths.flatMap((filepath) =>
        wanted.has(classifyPath(filepath)) && filepath.includes("/") ? [filepath.split("/")[0]] : [],
      ),
    ),
  ]
    .filter(Boolean)
    .sort()
}

function json(content: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(content) as unknown
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function quoted(value: string): string[] {
  return [...value.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function globMatch(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\//, "")
  const normalizedValue = value.replaceAll("\\", "/").replace(/^\.\//, "")
  const escaped = normalizedPattern
    .split("**")
    .map((part) => part.split("*").map(escapeRegex).join("[^/]*"))
    .join(".*")
  return new RegExp(`^${escaped}/?$`).test(normalizedValue)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export * as CodebaseMap from "./map"
