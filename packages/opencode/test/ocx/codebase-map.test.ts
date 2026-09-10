import { describe, expect, test } from "bun:test"
import { discoverMap, moduleForPath, relatedModules } from "../../src/ocx/codebase/map"
import { detectFingerprints } from "../../src/ocx/codebase/fingerprint"

const paths = [
  "package.json",
  "packages/app/src/index.ts",
  "packages/app/tests/index.test.ts",
  "packages/lib/src/index.ts",
  "BUILD.bazel",
  "packages/app/BUILD.bazel",
]

describe("codebase map", () => {
  test("discovers Node workspace and Bazel module boundaries", () => {
    const map = discoverMap({
      root: "/repo",
      paths,
      buildSystems: ["Node", "Bazel"],
      buildFiles: {
        "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "BUILD.bazel": "",
        "packages/app/BUILD.bazel": "",
      },
    })
    expect(map.modules.some((item) => item.path === "packages/app")).toBe(true)
    expect(map.modules.some((item) => item.path === "packages/lib")).toBe(true)
    expect(map.modules.some((item) => item.path === "packages/app" && item.buildSystem === "Bazel")).toBe(true)
    expect(moduleForPath(map, "packages/app/src/index.ts")?.path).toBe("packages/app")
    expect(relatedModules(map, "packages/app").some((item) => item.path === "packages/lib")).toBe(true)
  })

  test("detects repository family hints from evidence", () => {
    const result = detectFingerprints({
      paths: ["BUILD", "services/api/BUILD", "packages/app/src/index.ts"],
      rootEntries: ["BUILD", "packages"],
      buildSystems: ["Bazel"],
    })
    expect(result.map((item) => item.id)).toContain("bazel_monorepo")
  })
})
