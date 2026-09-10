import { describe, expect, test } from "bun:test"
import { BuildGuard } from "../../src/ocx/build-guard"

describe("build guard", () => {
  test("detects Bazel build files", () => {
    expect(BuildGuard.detectBuildSystemByPaths(["repo/BUILD.bazel"])).toBe("Bazel")
    expect(BuildGuard.detectBuildSystemByRoot(["WORKSPACE"])).toBe("Bazel")
  })

  test("does not misidentify build-output directories as Bazel", () => {
    expect(BuildGuard.detectBuildSystemByPaths(["build"])).toBeUndefined()
    expect(BuildGuard.detectBuildSystemByPaths(["dist"])).toBeUndefined()
    expect(BuildGuard.detectBuildSystemByRoot(["build"])).toBeUndefined()
    expect(BuildGuard.detectBuildSystemByRoot(["workspace"])).toBeUndefined()
  })

  test("detects Bazel build-backed commands", () => {
    expect(BuildGuard.looksLikeBuildCommand("bazel build //...")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("bazel test //packages/opencode:ocx")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("bazelisk coverage //...")).toBe(true)
  })

  test("detects AOSP and Spring Boot / Maven / Gradle build-backed commands", () => {
    expect(BuildGuard.looksLikeBuildCommand("m")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("mm")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("mma")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("atest MyModuleTests")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("mvn compile")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("./mvnw spring-boot:run")).toBe(true)
    expect(BuildGuard.looksLikeBuildCommand("./gradlew bootJar")).toBe(true)
    expect(BuildGuard.classifyCommand("mvn compile").permission).toBe("build")
    expect(BuildGuard.classifyCommand("./gradlew bootRun").permission).toBe("build")
    expect(BuildGuard.classifyCommand("m").permission).toBe("build")
    expect(BuildGuard.classifyCommand("m").requiresPermission).toBe(true)
  })

  test("does not treat static checks as builds", () => {
    expect(BuildGuard.looksLikeBuildCommand("bun run typecheck")).toBe(false)
    expect(BuildGuard.looksLikeBuildCommand("git diff --check")).toBe(false)
  })

  test("states that build approval is required", () => {
    const note = BuildGuard.guardNote("Bazel")
    expect(note).toContain("asking the user first")
    expect(note).toContain("bazel build/test commands")
  })

  test("classifies tests, unknown wrappers, and clean operations separately", () => {
    expect(BuildGuard.classifyCommand("npm test").permission).toBe("build_test")
    expect(BuildGuard.classifyCommand("./tools/project-verify").permission).toBe("build_unknown")
    expect(BuildGuard.classifyCommand("bazel clean").permission).toBe("build_clean")
    expect(BuildGuard.classifyCommand("echo clean").requiresPermission).toBe(false)
    expect(BuildGuard.classifyCommand("git diff --check").requiresPermission).toBe(false)
  })
})
