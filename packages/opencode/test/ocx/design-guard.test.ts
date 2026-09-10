import { describe, expect, test } from "bun:test"
import { PRODUCT_SIGNALS, GENERATED_SUBJECT } from "../../src/tool/design"

describe("product imagery gate signals", () => {
  test("matches booking/property surfaces", () => {
    expect(PRODUCT_SIGNALS.test("Booking product landing page")).toBe(true)
    expect(PRODUCT_SIGNALS.test("Internal admin dashboard")).toBe(false)
  })

  test("matches generated-subject media plans", () => {
    expect(GENERATED_SUBJECT.test("mediaPlan: Generate local SVG files for the hero illustration study")).toBe(true)
    // A download-first plan is not a generated subject; the gate's photo/download
    // allowance handles it separately.
    expect(GENERATED_SUBJECT.test("mediaPlan: Download licensed product photographs into assets/")).toBe(false)
  })
})
