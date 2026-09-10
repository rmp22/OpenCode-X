import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Effect } from "effect"
import { OCXToolRail } from "../../src/ocx/tool-rail"
import { tmpdir } from "../fixture/fixture"

describe("OCX tool rail", () => {
  test("reports syntax errors only for enabled mutation tools", async () => {
    await using directory = await tmpdir()
    const filePath = join(directory.path, "broken.ts")
    await Bun.write(filePath, "const = = 2\n")

    const feedback = await Effect.runPromise(
      OCXToolRail.syntaxFeedback({ enabled: true, toolID: "edit", args: { filePath } }),
    )
    expect(feedback).toContain("[ocx rail] syntax error")
    expect(
      await Effect.runPromise(OCXToolRail.syntaxFeedback({ enabled: false, toolID: "edit", args: { filePath } })),
    ).toBeUndefined()
    expect(
      await Effect.runPromise(OCXToolRail.syntaxFeedback({ enabled: true, toolID: "read", args: { filePath } })),
    ).toBeUndefined()
  })
})
