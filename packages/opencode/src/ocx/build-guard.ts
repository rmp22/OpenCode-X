const BUILD_FILES: [RegExp, string][] = [
  [/^Android\.bp$/i, "Soong/Blueprint"],
  [/\.bp$/i, "Blueprint"],
  [/^Android\.mk$/i, "Android Makefile"],
  [/^(?:Makefile|makefile)$/i, "GNU make"],
  [/\.m(?:k)?$/i, "GNU make"],
  [/^(?:BUILD|BUILD\.bazel|MODULE\.bazel|WORKSPACE)$/, "Bazel"],
  [/^CMakeLists\.txt$/i, "CMake"],
  [/^(?:build|settings)\.gradle(?:\.kts)?$/i, "Gradle"],
  [/^pom\.xml$/i, "Maven"],
  [/^Cargo\.toml$/i, "Cargo"],
  [/^(?:go\.mod|go\.work)$/i, "Go"],
  [/^(?:package\.json|pnpm-workspace\.yaml|yarn\.lock)$/i, "Node"],
  [/^(?:pyproject\.toml|requirements\.txt)$/i, "Python"],
  [/\.(?:sln|csproj)$/i, ".NET"],
]

export function detectBuildSystemByPaths(paths: readonly string[]): string | undefined {
  for (const path of paths)
    for (const [pattern, name] of BUILD_FILES) if (pattern.test(path.split("/").pop() ?? "")) return name
  return undefined
}

export function detectBuildSystemByRoot(files: readonly string[]): string | undefined {
  for (const name of files) for (const [pattern, system] of BUILD_FILES) if (pattern.test(name)) return system
  return undefined
}

export function detectBuildSystems(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths.flatMap((path) => {
        const name = path.split(/[\\/]/).pop() ?? path
        return BUILD_FILES.flatMap(([pattern, system]) => (pattern.test(name) ? [system] : []))
      }),
    ),
  ]
}

const BUILD_COMMAND =
  /(?:^|\s|[;&|])(?:\.\/)?(?:mm|mmma|mma|mka|m|bacon|soong|ninja|atest|make|cmake --build|go (?:build|install|test)|gradle|gradlew|mvn|mvnw|(?:bazel|bazelisk) (?:build|test|run|coverage))\b/

const TEST_COMMAND = /(?:^|\s|[;&|])(?:\.\/)?(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:^|\s|[;&|])(?:\.\/)?(?:cargo|go|mvn|mvnw|gradle|gradlew)\s+test\b/i
const COMPILER_COMMAND = /(?:^|[;&|]\s*)(?:tsc|tsgo|javac|kotlinc|rustc|clang|clang\+\+|gcc|g\+\+|dotnet)\b/i
const UNKNOWN_WRAPPER =
  /(?:^|[;&|]\s*)(?:(?:\.\/|(?:scripts|tools|bin)\/)[^\s;&|]*(?:build|compile|package|check|verify|test|install|deploy)[^\s;&|]*|(?!(?:echo|printf|true|false|test|command|env)\s)[A-Za-z0-9_.-]+\s+(?:build|compile|package|check|verify|test|install|deploy)\b)/i
const CLEAN_COMMAND =
  /(?:^|[;&|]\s*)(?:(?:bazel|bazelisk|cargo|gradle|mvn|make|ninja)\s+(?:clean|distclean)|(?:\.\/|(?:scripts|tools|bin)\/)[^\s;&|]*(?:clean|distclean)[^\s;&|]*)\b/i

export type BuildCommandKind = "build" | "test" | "compile" | "unknown" | "clean"

export type BuildCommandDecision = {
  readonly requiresPermission: boolean
  readonly permission: "build" | "build_test" | "build_compile" | "build_unknown" | "build_clean"
  readonly kind?: BuildCommandKind
  readonly destructive: boolean
  readonly reason?: string
}

export function looksLikeBuildCommand(command: string): boolean {
  return BUILD_COMMAND.test(command)
}

export function classifyCommand(command: string): BuildCommandDecision {
  const value = command.trim()
  if (CLEAN_COMMAND.test(value)) {
    return {
      requiresPermission: true,
      permission: "build_clean",
      kind: "clean",
      destructive: true,
      reason: "clean or distclean changes or deletes build state",
    }
  }
  if (TEST_COMMAND.test(value)) {
    return {
      requiresPermission: true,
      permission: "build_test",
      kind: "test",
      destructive: false,
      reason: "project tests may invoke compilation or artifact-producing steps",
    }
  }
  if (COMPILER_COMMAND.test(value)) {
    return {
      requiresPermission: true,
      permission: "build_compile",
      kind: "compile",
      destructive: false,
      reason: "compiler invocation may create artifacts or update incremental state",
    }
  }
  if (looksLikeBuildCommand(value)) {
    return {
      requiresPermission: true,
      permission: "build",
      kind: "build",
      destructive: false,
      reason: "build command may create artifacts or update build state",
    }
  }
  if (UNKNOWN_WRAPPER.test(value)) {
    return {
      requiresPermission: true,
      permission: "build_unknown",
      kind: "unknown",
      destructive: false,
      reason: "repository-specific verification behavior is unknown",
    }
  }
  return {
    requiresPermission: false,
    permission: "build",
    destructive: false,
  }
}

export function guardNote(system: string): string {
  const example = system === "Bazel" ? "bazel build/test commands" : `${system} build commands`
  return [
    "=== OCX BUILD SYSTEM GUARD ===",
    `This repository uses ${system} build files. Do NOT run builds or build-backed tests, including ${example}, without asking the user first.`,
    "Building here can regenerate shared artifacts outside your change. Ask whether to include building in verification, and treat the answer as binding for the whole session.",
    "Static checks, typechecks of single files, and plain reads stay allowed.",
    "=== END OCX BUILD SYSTEM GUARD ===",
  ].join("\n")
}

export * as BuildGuard from "./build-guard"
