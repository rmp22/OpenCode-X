import { describe, expect, test } from "bun:test"
import {
  classifyPath,
  classifyScale,
  isFresh,
  markerSignature,
  parseProfile,
  profileFromPaths,
} from "../../src/ocx/codebase/profile"

const thresholds = {
  smallMaxFiles: 5_000,
  mediumMaxFiles: 50_000,
  largeMaxFiles: 250_000,
}

describe("codebase profile", () => {
  test("classifies configured repository scales at each boundary", () => {
    expect(classifyScale(5_000, thresholds)).toBe("SMALL")
    expect(classifyScale(5_001, thresholds)).toBe("MEDIUM")
    expect(classifyScale(50_001, thresholds)).toBe("LARGE")
    expect(classifyScale(250_001, thresholds)).toBe("MASSIVE")
  })

  test("identifies source, test, generated, dependency, and output paths", () => {
    expect(classifyPath("src/auth.ts")).toBe("SOURCE")
    expect(classifyPath("tests/auth.test.ts")).toBe("TEST")
    expect(classifyPath("generated/schema.ts")).toBe("GENERATED")
    expect(classifyPath("node_modules/pkg/index.js")).toBe("DEPENDENCY")
    expect(classifyPath("dist/app.js")).toBe("BUILD_OUTPUT")
  })

  test("builds a bounded profile from sampled paths", () => {
    const profile = profileFromPaths({
      root: "/repo",
      paths: [
        "src/auth.ts",
        "tests/auth.test.ts",
        "generated/schema.ts",
        "third_party/lib.c",
        "BUILD.bazel",
        "package.json",
      ],
      rootEntries: [".git", "src", "tests", "generated", "third_party", "BUILD.bazel", "package.json"],
      trackedFileCount: 6,
      sourceRevision: "abc",
      thresholds,
    })
    expect(profile.root).toBe("/repo")
    expect(profile.scale).toBe("SMALL")
    expect(profile.languages).toContain("typescript")
    expect(profile.buildSystems).toContain("Bazel")
    expect(profile.sourceRoots).toContain("src")
    expect(profile.generatedRoots).toContain("generated")
    expect(profile.dependencyRoots).toContain("third_party")
    expect(profile.trackedFileCount).toBe(6)
    expect(profile.samplePaths.length).toBeLessThanOrEqual(4_096)
  })

  test("uses a conservative massive scale for an incomplete sample", () => {
    const profile = profileFromPaths({ root: "/repo", paths: ["src/a.ts"], truncated: true, thresholds })
    expect(profile.scale).toBe("MASSIVE")
    expect(profile.confidence).toBe("low")
  })

  test("rejects invalid cache data and detects revision or marker changes", () => {
    const profile = profileFromPaths({
      root: "/repo",
      paths: ["src/a.ts"],
      rootEntries: ["src"],
      sourceRevision: "abc",
      thresholds,
    })
    expect(parseProfile({ version: 1 })).toBeUndefined()
    expect(parseProfile({ ...profile, fileTypes: { ".ts": "bad" } })).toBeUndefined()
    expect(isFresh(profile, { root: "/repo", sourceRevision: "abc", rootEntries: ["src"] })).toBe(true)
    expect(isFresh(profile, { root: "/repo", sourceRevision: "def", rootEntries: ["src"] })).toBe(false)
    expect(isFresh(profile, { root: "/repo", sourceRevision: "abc", rootEntries: ["src", "new"] })).toBe(false)
    expect(markerSignature(["src", "new"])).not.toBe(profile.rootMarkerSignature)
  })

  test("does not include build-output directories in buildFiles", () => {
    const profile = profileFromPaths({
      root: "/repo",
      paths: ["src/main.ts", "pyproject.toml", "package.json"],
      rootEntries: ["build", "dist", "node_modules", "src", "pyproject.toml", "package.json"],
      trackedFileCount: 3,
      thresholds,
    })
    expect(profile.buildFiles).not.toContain("build")
    expect(profile.buildFiles).not.toContain("dist")
    expect(profile.buildFiles).not.toContain("node_modules")
    expect(profile.buildFiles).toContain("pyproject.toml")
    expect(profile.buildFiles).toContain("package.json")
  })
})
