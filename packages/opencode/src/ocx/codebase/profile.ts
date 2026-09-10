import { createHash } from "node:crypto"
import path from "node:path"
import { BuildGuard } from "@/ocx/build-guard"
import type { CodebaseConfig, PathClass, RepositoryProfile, Scale, ScaleThresholds } from "./types"
import { PATH_CLASS_VALUES, SCALE_VALUES } from "./types"

export type ProfileInput = {
  readonly root: string
  readonly paths: readonly string[]
  readonly rootEntries?: readonly string[]
  readonly trackedFileCount?: number
  readonly estimatedFileCount?: number
  readonly estimatedDirectoryCount?: number
  readonly estimatedBytes?: number
  readonly truncated?: boolean
  readonly sourceRevision?: string
  readonly now?: number
  readonly maxSamplePaths?: number
  readonly thresholds?: ScaleThresholds
}

const GENERATED_NAMES = new Set(["generated", "gen", "__generated__", "autogen", "bazel-genfiles"])
const BUILD_OUTPUT_NAMES = new Set(["bazel-out", "build", "dist", "out", "target", ".next", ".turbo"])
const DEPENDENCY_NAMES = new Set(["node_modules", "vendor", "third_party", "external", "deps", "gomodcache"])
const PREBUILT_NAMES = new Set(["prebuilt", "prebuilts", "bin"])
const CACHE_NAMES = new Set([".cache", ".gradle", ".m2", ".npm", ".pnpm-store", ".serena", ".idea"])
const TOOL_NAMES = new Set(["tools", "tool", "scripts", "bin"])
const TEST_NAMES = new Set(["test", "tests", "spec", "specs", "fixtures", "__tests__"])
const DOCUMENTATION_NAMES = new Set(["doc", "docs", "documentation"])
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".h": "c",
  ".hpp": "cpp",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".md": "markdown",
  ".mjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shell",
  ".sql": "sql",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
}

export function normalizeRoot(root: string): string {
  return path.resolve(root)
}

export function relativePath(root: string, value: string): string {
  const relative = path.relative(normalizeRoot(root), path.resolve(root, value))
  return relative.replaceAll(path.sep, "/") || "."
}

export function cacheKey(root: string): string {
  return createHash("sha256").update(normalizeRoot(root)).digest("hex").slice(0, 32)
}

export function markerSignature(entries: readonly string[]): string {
  return digest(
    entries
      .map((item) => path.basename(item))
      .filter((item) => item.length > 0)
      .sort(),
  )
}

export function topologySignature(paths: readonly string[]): string {
  return digest(unique(paths).sort())
}

export function languageForPath(filepath: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[path.extname(filepath).toLowerCase()]
}

export function classifyPath(filepath: string): PathClass {
  const normalized = filepath.replaceAll("\\", "/").replace(/^\.\//, "")
  const parts = normalized.split("/").filter(Boolean)
  const lower = parts.map((item) => item.toLowerCase())
  const basename = lower.at(-1) ?? ""
  if (lower.includes(".git") || lower.includes(".hg") || lower.includes(".svn")) return "VCS_METADATA"
  if (lower.some((item) => BUILD_OUTPUT_NAMES.has(item))) return "BUILD_OUTPUT"
  if (lower.some((item) => CACHE_NAMES.has(item))) return "CACHE"
  if (lower.some((item) => DEPENDENCY_NAMES.has(item))) {
    return lower.includes("vendor") || lower.includes("third_party") ? "VENDOR" : "DEPENDENCY"
  }
  if (lower.some((item) => PREBUILT_NAMES.has(item))) return "PREBUILT"
  if (lower.some((item) => GENERATED_NAMES.has(item)) || /(?:\.gen|\.generated)(?:\.|$)/.test(basename))
    return "GENERATED"
  if (lower.some((item) => TEST_NAMES.has(item)) || /(?:\.test|\.spec)(?:\.|$)/.test(basename)) return "TEST"
  if (lower.some((item) => DOCUMENTATION_NAMES.has(item)) || /^(?:readme|changelog|license)(?:\.|$)/.test(basename))
    return "DOCUMENTATION"
  if (lower.some((item) => TOOL_NAMES.has(item))) return "TOOLS"
  return "SOURCE"
}

export function classifyScale(fileCount: number, thresholds: ScaleThresholds): Scale {
  if (!Number.isFinite(fileCount) || fileCount < 0) return "MASSIVE"
  if (fileCount <= thresholds.smallMaxFiles) return "SMALL"
  if (fileCount <= thresholds.mediumMaxFiles) return "MEDIUM"
  if (fileCount <= thresholds.largeMaxFiles) return "LARGE"
  return "MASSIVE"
}

export function profileFromPaths(input: ProfileInput): RepositoryProfile {
  const root = normalizeRoot(input.root)
  const paths = unique(input.paths.map((item) => relativePath(root, item)))
  const rootEntries = unique((input.rootEntries ?? []).map((item) => path.basename(item)))
  const thresholds = input.thresholds ?? {
    smallMaxFiles: 5_000,
    mediumMaxFiles: 50_000,
    largeMaxFiles: 250_000,
  }
  const truncated = input.truncated === true
  const estimatedFileCount = truncated
    ? Math.max(input.estimatedFileCount ?? 0, thresholds.largeMaxFiles + 1)
    : Math.max(input.estimatedFileCount ?? paths.length, paths.length)
  const classes = new Map<string, PathClass>()
  for (const item of paths) classes.set(item, classifyPath(item))
  const fileTypes: Record<string, number> = {}
  for (const item of paths) {
    const extension = path.extname(item).toLowerCase() || "(none)"
    fileTypes[extension] = (fileTypes[extension] ?? 0) + 1
  }
  const languageCounts = new Map<string, number>()
  for (const item of paths) {
    const language = languageForPath(item)
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1)
  }
  const sourceRoots = rootsFor(paths, classes, "SOURCE")
  const testRoots = rootsFor(paths, classes, "TEST")
  const generatedRoots = rootsFor(paths, classes, "GENERATED").filter((root) => !sourceRoots.includes(root))
  const dependencyRoots = rootsFor(paths, classes, "DEPENDENCY", "VENDOR").filter((root) => !sourceRoots.includes(root))
  const buildFiles = unique(
    [...rootEntries, ...paths].filter(
      (item) =>
        classifyPath(item) === "SOURCE" && BuildGuard.detectBuildSystemByPaths([item]) !== undefined,
    ),
  ).sort()
  const buildSystems = BuildGuard.detectBuildSystems(buildFiles)
  const repoTypes = repositoryTypes(rootEntries, buildSystems)
  const maxSamplePaths = input.maxSamplePaths ?? 4_096
  const samplePaths = paths.toSorted().slice(0, maxSamplePaths)
  const count = truncated ? estimatedFileCount : paths.length
  return {
    version: 1,
    root,
    scale: classifyScale(count, thresholds),
    estimatedFileCount: count,
    estimatedDirectoryCount: input.estimatedDirectoryCount ?? directoryCount(paths),
    ...(input.trackedFileCount === undefined ? {} : { trackedFileCount: input.trackedFileCount }),
    ...(input.estimatedBytes === undefined ? {} : { estimatedBytes: input.estimatedBytes }),
    languages: [...languageCounts.entries()]
      .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([language]) => language)
      .slice(0, 12),
    fileTypes,
    buildSystems,
    repoTypes,
    sourceRoots,
    generatedRoots,
    dependencyRoots,
    buildFiles,
    samplePaths,
    rootEntries,
    rootMarkerSignature: markerSignature(rootEntries),
    topologySignature: topologySignature(paths),
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    profileTimestamp: input.now ?? Date.now(),
    confidence: truncated ? "low" : paths.length > 0 ? "high" : "medium",
  }
}

export function parseProfile(value: unknown): RepositoryProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (input.version !== 1 || typeof input.root !== "string" || !SCALE_VALUES.includes(input.scale as Scale))
    return undefined
  if (!finite(input.estimatedFileCount) || !finite(input.estimatedDirectoryCount) || !finite(input.profileTimestamp))
    return undefined
  const arrays = [
    "languages",
    "buildSystems",
    "repoTypes",
    "sourceRoots",
    "generatedRoots",
    "dependencyRoots",
    "buildFiles",
    "samplePaths",
    "rootEntries",
  ]
  if (arrays.some((key) => !strings(input[key]))) return undefined
  if (typeof input.rootMarkerSignature !== "string" || typeof input.topologySignature !== "string") return undefined
  if (input.confidence !== "high" && input.confidence !== "medium" && input.confidence !== "low") return undefined
  const fileTypes = input.fileTypes
  if (!fileTypes || typeof fileTypes !== "object" || Array.isArray(fileTypes)) return undefined
  if (!Object.values(fileTypes).every((value) => finite(value) && value >= 0)) return undefined
  const result: RepositoryProfile = {
    version: 1,
    root: input.root,
    scale: input.scale as Scale,
    estimatedFileCount: input.estimatedFileCount as number,
    estimatedDirectoryCount: input.estimatedDirectoryCount as number,
    ...(finite(input.trackedFileCount) ? { trackedFileCount: input.trackedFileCount as number } : {}),
    ...(finite(input.estimatedBytes) ? { estimatedBytes: input.estimatedBytes as number } : {}),
    languages: input.languages as string[],
    fileTypes: fileTypes as Record<string, number>,
    buildSystems: input.buildSystems as string[],
    repoTypes: input.repoTypes as string[],
    sourceRoots: input.sourceRoots as string[],
    generatedRoots: input.generatedRoots as string[],
    dependencyRoots: input.dependencyRoots as string[],
    buildFiles: input.buildFiles as string[],
    samplePaths: input.samplePaths as string[],
    rootEntries: input.rootEntries as string[],
    rootMarkerSignature: input.rootMarkerSignature,
    topologySignature: input.topologySignature,
    ...(typeof input.sourceRevision === "string" ? { sourceRevision: input.sourceRevision } : {}),
    profileTimestamp: input.profileTimestamp as number,
    confidence: input.confidence,
  }
  return result
}

export function isFresh(
  profile: RepositoryProfile,
  input: { readonly root: string; readonly sourceRevision?: string; readonly rootEntries?: readonly string[] },
): boolean {
  if (profile.version !== 1 || profile.root !== normalizeRoot(input.root)) return false
  if ((profile.sourceRevision ?? undefined) !== (input.sourceRevision ?? undefined)) return false
  if (input.rootEntries && profile.rootMarkerSignature !== markerSignature(input.rootEntries)) return false
  return true
}

export function repositoryRoot(start: string, markers: readonly string[]): string {
  const root = normalizeRoot(start)
  const known = new Set(markers.map((item) => path.basename(item)))
  if (known.has(".git")) return root
  return root
}

export function configFromEnvironment(environment: NodeJS.ProcessEnv = process.env): CodebaseConfig {
  const number = (name: string, fallback: number) => {
    const value = Number(environment[name])
    return Number.isInteger(value) && value > 0 ? value : fallback
  }
  const boolean = (name: string, fallback: boolean) => {
    const value = environment[name]?.trim().toLowerCase()
    if (value === undefined || value === "") return fallback
    if (value === "1" || value === "true" || value === "yes") return true
    if (value === "0" || value === "false" || value === "no") return false
    return fallback
  }
  const thresholds = {
    smallMaxFiles: number("OPENCODE_CIS_SMALL_MAX_FILES", 5_000),
    mediumMaxFiles: number("OPENCODE_CIS_MEDIUM_MAX_FILES", 50_000),
    largeMaxFiles: number("OPENCODE_CIS_LARGE_MAX_FILES", 250_000),
  }
  return {
    enabled: boolean("OPENCODE_CIS_ENABLED", true),
    blockMassiveRootRecursiveSearch: boolean("OPENCODE_CIS_BLOCK_MASSIVE_ROOT_SEARCH", true),
    rewriteBroadSearches: boolean("OPENCODE_CIS_REWRITE_BROAD_SEARCHES", true),
    killProcessTreeOnTimeout: boolean("OPENCODE_CIS_KILL_PROCESS_TREE_ON_TIMEOUT", true),
    scaleThresholds: thresholds,
    budgets: {
      small: {
        softTimeoutMs: number("OPENCODE_CIS_SMALL_SOFT_TIMEOUT_MS", 10_000),
        hardTimeoutMs: number("OPENCODE_CIS_SMALL_HARD_TIMEOUT_MS", 30_000),
        maxOutputLines: number("OPENCODE_CIS_SMALL_MAX_OUTPUT_LINES", 5_000),
        maxOutputBytes: number("OPENCODE_CIS_SMALL_MAX_OUTPUT_BYTES", 512_000),
        maxResults: number("OPENCODE_CIS_SMALL_MAX_RESULTS", 1_000),
      },
      medium: {
        softTimeoutMs: number("OPENCODE_CIS_MEDIUM_SOFT_TIMEOUT_MS", 5_000),
        hardTimeoutMs: number("OPENCODE_CIS_MEDIUM_HARD_TIMEOUT_MS", 15_000),
        maxOutputLines: number("OPENCODE_CIS_MEDIUM_MAX_OUTPUT_LINES", 2_000),
        maxOutputBytes: number("OPENCODE_CIS_MEDIUM_MAX_OUTPUT_BYTES", 256_000),
        maxResults: number("OPENCODE_CIS_MEDIUM_MAX_RESULTS", 500),
      },
      large: {
        softTimeoutMs: number("OPENCODE_CIS_LARGE_SOFT_TIMEOUT_MS", 3_000),
        hardTimeoutMs: number("OPENCODE_CIS_LARGE_HARD_TIMEOUT_MS", 10_000),
        maxOutputLines: number("OPENCODE_CIS_LARGE_MAX_OUTPUT_LINES", 1_000),
        maxOutputBytes: number("OPENCODE_CIS_LARGE_MAX_OUTPUT_BYTES", 128_000),
        maxResults: number("OPENCODE_CIS_LARGE_MAX_RESULTS", 250),
      },
      massive: {
        softTimeoutMs: number("OPENCODE_CIS_MASSIVE_SOFT_TIMEOUT_MS", 2_000),
        hardTimeoutMs: number("OPENCODE_CIS_MASSIVE_HARD_TIMEOUT_MS", 8_000),
        maxOutputLines: number("OPENCODE_CIS_MASSIVE_MAX_OUTPUT_LINES", 500),
        maxOutputBytes: number("OPENCODE_CIS_MASSIVE_MAX_OUTPUT_BYTES", 64_000),
        maxResults: number("OPENCODE_CIS_MASSIVE_MAX_RESULTS", 100),
      },
    },
    maxWorkingSetModules: number("OPENCODE_CIS_MAX_WORKING_SET_MODULES", 32),
    maxWorkingSetDirectories: number("OPENCODE_CIS_MAX_WORKING_SET_DIRECTORIES", 128),
    maxHistoryEntries: number("OPENCODE_CIS_MAX_HISTORY_ENTRIES", 256),
    maxProfileSamplePaths: number("OPENCODE_CIS_MAX_PROFILE_SAMPLE_PATHS", 4_096),
    maxProfileOutputBytes: number("OPENCODE_CIS_MAX_PROFILE_OUTPUT_BYTES", 8 * 1024 * 1024),
  }
}

function rootsFor(paths: readonly string[], classes: ReadonlyMap<string, PathClass>, ...wanted: PathClass[]): string[] {
  const result = new Set<string>()
  for (const item of paths) {
    if (!wanted.includes(classes.get(item) ?? "UNKNOWN")) continue
    if (!item.includes("/")) continue
    const root = item.split("/")[0]
    if (root && root !== ".") result.add(root)
  }
  return [...result].sort().slice(0, 64)
}

function repositoryTypes(entries: readonly string[], systems: readonly string[]): string[] {
  const result = new Set<string>()
  if (entries.some((item) => item.toLowerCase() === ".git")) result.add("git")
  const types: Record<string, string> = {
    Bazel: "bazel_monorepo",
    Cargo: "rust_workspace",
    Go: "go_workspace",
    Node: "node_monorepo",
    Gradle: "gradle_multi_project",
    Maven: "maven_multi_module",
    CMake: "cmake_project",
    Python: "python_project",
    ".NET": "dotnet_solution",
  }
  for (const system of systems) {
    const type = types[system]
    if (type) result.add(type)
  }
  return [...result]
}

function directoryCount(paths: readonly string[]): number {
  const directories = new Set<string>()
  for (const item of paths) {
    const parts = item.split("/")
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join("/"))
  }
  return directories.size
}

function digest(values: readonly string[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex")
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export * as CodebaseProfile from "./profile"
