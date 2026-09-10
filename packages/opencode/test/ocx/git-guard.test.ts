import { describe, expect, test } from "bun:test"
import { GitGuard } from "../../src/ocx/git-guard"

const dirty = {
  known: true,
  entries: [
    { file: "src/user.ts", code: " M", status: "modified" as const },
    { file: "new.ts", code: "??", status: "added" as const },
  ],
}

describe("git guard", () => {
  test("parses porcelain status and detects mixed paths", () => {
    expect(GitGuard.parseStatus(" M src/user.ts\0?? new.ts\0")).toEqual(dirty.entries)
    const command = GitGuard.classify("git add src/user.ts")
    expect(GitGuard.evaluate(command, dirty)?.action).toBe("BLOCK")
  })

  test("blocks broad stage, restore, and commit shortcuts", () => {
    expect(GitGuard.evaluate(GitGuard.classify("git add ."), dirty)?.action).toBe("BLOCK")
    expect(GitGuard.evaluate(GitGuard.classify("git restore ."), dirty)?.action).toBe("BLOCK")
    expect(GitGuard.evaluate(GitGuard.classify("git commit -a -m x"), dirty)?.action).toBe("BLOCK")
  })

  test("uses separate permissions for destructive and dirty-workspace operations", () => {
    expect(GitGuard.evaluate(GitGuard.classify("git clean -fd"), dirty)?.permission).toBe("git_destructive")
    expect(GitGuard.evaluate(GitGuard.classify("git push --force"), dirty)?.permission).toBe("git_force_push")
    expect(GitGuard.evaluate(GitGuard.classify("git switch other"), dirty)?.permission).toBe("git_dirty_workspace")
  })
})
