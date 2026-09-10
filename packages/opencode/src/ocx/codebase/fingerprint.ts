import path from "node:path"

export type Fingerprint = {
  readonly id: string
  readonly confidence: number
  readonly evidence: readonly string[]
}

export function detectFingerprints(input: {
  readonly paths: readonly string[]
  readonly rootEntries?: readonly string[]
  readonly buildSystems?: readonly string[]
}): Fingerprint[] {
  const paths = input.paths.map((item) => item.replaceAll("\\", "/").toLowerCase())
  const entries = new Set((input.rootEntries ?? []).map((item) => path.basename(item).toLowerCase()))
  const systems = new Set(input.buildSystems ?? [])
  const result: Fingerprint[] = []
  add(
    result,
    "android_platform",
    0.95,
    ["Android.bp", "build/blueprint"],
    entries.has("android.bp") && (entries.has("frameworks") || paths.some((item) => item.startsWith("frameworks/"))),
  )
  add(
    result,
    "linux_kernel",
    0.9,
    ["Kconfig", "arch/", "drivers/"],
    entries.has("kconfig") && (entries.has("arch") || entries.has("drivers")),
  )
  add(
    result,
    "chromium",
    0.9,
    ["DEPS", "chrome/", "content/"],
    entries.has("deps") && (entries.has("chrome") || entries.has("content")),
  )
  add(
    result,
    "llvm",
    0.88,
    ["llvm/", "clang/", "CMake"],
    paths.some((item) => item.startsWith("llvm/")) && systems.has("CMake"),
  )
  add(
    result,
    "bazel_monorepo",
    0.9,
    ["Bazel", "BUILD"],
    systems.has("Bazel") && paths.filter((item) => /(?:^|\/)build(?:\.bazel)?$/.test(item)).length > 1,
  )
  add(
    result,
    "rust_workspace",
    0.85,
    ["Cargo.toml", "crates/"],
    systems.has("Cargo") && (entries.has("crates") || paths.some((item) => item.startsWith("crates/"))),
  )
  add(
    result,
    "go_workspace",
    0.85,
    ["go.work", "go.mod"],
    systems.has("Go") && (entries.has("go.work") || entries.has("go.mod")),
  )
  add(
    result,
    "node_monorepo",
    0.8,
    ["package.json", "packages/"],
    systems.has("Node") && (entries.has("packages") || paths.some((item) => item.startsWith("packages/"))),
  )
  add(
    result,
    "gradle_multi_project",
    0.8,
    ["settings.gradle", "build.gradle"],
    systems.has("Gradle") && (entries.has("settings.gradle") || entries.has("settings.gradle.kts")),
  )
  add(result, "maven_multi_module", 0.8, ["pom.xml", "<module>"], systems.has("Maven") && entries.has("pom.xml"))
  add(result, "cmake_project", 0.75, ["CMakeLists.txt"], systems.has("CMake") && entries.has("cmakelists.txt"))
  add(
    result,
    "python_monorepo",
    0.75,
    ["pyproject.toml"],
    systems.has("Python") && (entries.has("pyproject.toml") || entries.has("requirements.txt")),
  )
  return result.toSorted((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))
}

function add(result: Fingerprint[], id: string, confidence: number, evidence: readonly string[], matches: boolean) {
  if (matches) result.push({ id, confidence, evidence })
}

export * as CodebaseFingerprint from "./fingerprint"
