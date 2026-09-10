import { describe, expect, test } from "bun:test"
import { chunkFileContent } from "@/ocx/retrieval/chunker"
import { RepositorySymbolMap } from "@/ocx/retrieval/repo-map"

describe("Retrieval Pipeline", () => {
  test("chunks code by declarations", () => {
    const code = `
export function add(a: number, b: number): number {
  return a + b
}

export function subtract(a: number, b: number): number {
  return a - b
}
`
    const chunks = chunkFileContent("math.ts", code)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })

  test("ranks search results by keyword and proximity", () => {
    const map = new RepositorySymbolMap()
    map.indexFile(
      "src/user.ts",
      `export function getUser(id: string) { return { id } }\nexport function deleteUser(id: string) {}`,
    )
    map.indexFile(
      "src/auth.ts",
      `export function login(token: string) {}\nexport function logout() {}`,
    )

    const result = map.search({
      query: "getUser",
      contextFiles: ["src/user.ts"],
    })

    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks[0].filePath).toBe("src/user.ts")
  })
})
