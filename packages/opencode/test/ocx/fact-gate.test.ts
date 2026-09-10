import { describe, expect, test } from "bun:test"
import { FactGate } from "../../src/ocx/fact-gate"

describe("fact gate reference findings", () => {
  test("flags arxiv and doi citations on a closed-book turn", () => {
    const reply =
      "The result matches arxiv.org/abs/2509.04664 and the survey at https://doi.org/10.1145/3703155."
    const findings = FactGate.referenceFindings(reply, false)
    expect(findings.map((finding) => finding.id)).toEqual([
      "F1-unverified-reference",
      "F1-unverified-reference",
    ])
    expect(findings[0].span).toBe("2509.04664")
    expect(findings[1].span).toContain("10.1145/3703155")
    expect(findings[1].span).not.toContain("(")
  })

  test("stays silent when the cited source was opened", () => {
    const reply = "Per arxiv.org/abs/2509.04664, evals reward guessing."
    expect(FactGate.referenceFindings(reply, ["https://arxiv.org/abs/2509.04664"])).toEqual([])
  })

  test("flags a citation that does not match opened source evidence", () => {
    const reply = "Per https://example.com/other, the result holds."
    const findings = FactGate.referenceFindings(reply, ["https://example.com/paper"])
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("no opened source matches")
  })

  test("matches DOI evidence extracted from a fetched page", () => {
    const reply = "The paper uses DOI 10.1000/example.1."
    expect(FactGate.referenceFindings(reply, ["doi:10.1000/example.1"])).toEqual([])
  })

  test("matches plain arxiv identifiers against an opened arxiv URL", () => {
    const reply = "The result is reported in arXiv:2509.04664."
    expect(FactGate.referenceFindings(reply, ["https://arxiv.org/abs/2509.04664"])).toEqual([])
  })

  test("stays silent without references", () => {
    const reply = "Refactor done. Tests and typecheck are green."
    expect(FactGate.referenceFindings(reply, false)).toEqual([])
  })

  test("dedupes repeated ids and caps at three findings", () => {
    const reply = [
      "arxiv.org/abs/2309.03883",
      "arxiv.org/pdf/2309.03883v2",
      "https://doi.org/10.1038/s41586-024-07421-0.",
      "see also arxiv.org/html/2406.15927",
      "and arxiv.org/abs/2604.11141",
    ].join(" ")
    const findings = FactGate.referenceFindings(reply, false)
    expect(findings).toHaveLength(3)
    expect(new Set(findings.map((finding) => finding.span)).size).toBe(3)
  })
})
