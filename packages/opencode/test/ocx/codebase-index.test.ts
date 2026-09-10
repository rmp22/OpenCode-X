import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { CodebasePathIndex } from "../../src/ocx/codebase/path-index"

describe("codebase path index", () => {
  test("looks up basenames and removes stale paths from a complete refresh", async () => {
    await using tmp = await tmpdir()
    const index = await Effect.runPromise(CodebasePathIndex.open(path.join(tmp.path, "index.sqlite")))
    index.sync(
      "/repo",
      CodebasePathIndex.recordsFromPaths({
        root: "/repo",
        paths: ["src/Widget.ts", "src/old.ts", "src/100%.ts", "tests/Widget.test.ts"],
      }),
      true,
    )
    expect(index.lookupFile("Widget.ts", "/repo").map((item) => item.path)).toEqual(["src/Widget.ts"])
    expect(index.lookupPath("src", "/repo").map((item) => item.path)).toEqual([
      "src/100%.ts",
      "src/Widget.ts",
      "src/old.ts",
    ])
    expect(index.lookupPath("%", "/repo").map((item) => item.path)).toEqual(["src/100%.ts"])
    index.sync(
      "/repo",
      CodebasePathIndex.recordsFromPaths({ root: "/repo", paths: ["src/Widget.ts", "tests/Widget.test.ts"] }),
      true,
    )
    expect(index.lookupFile("old.ts", "/repo")).toEqual([])
    expect(index.lookupTests("Widget", "/repo").map((item) => item.path)).toEqual(["tests/Widget.test.ts"])
    index.close()
  })
})
