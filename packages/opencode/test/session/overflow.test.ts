import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Provider } from "../../src/provider/provider"
import { usable } from "../../src/session/overflow"

const config = { compaction: { reserved: 0 } } as ConfigV1.Info

const model = (context: number, input?: number) =>
  ({ limit: { context, ...(input === undefined ? {} : { input }), output: 64_000 } }) as Provider.Model

describe("session overflow window", () => {
  test("uses the lower context limit when input limit is larger", () => {
    expect(usable({ cfg: config, model: model(256_000, 900_000) })).toBe(256_000)
  })

  test("preserves an explicitly configured larger context window", () => {
    expect(usable({ cfg: config, model: model(1_000_000, 900_000) })).toBe(900_000)
  })
})
