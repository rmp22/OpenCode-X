import { describe, expect, test } from "bun:test"
import { Wrapper } from "../../src/ocx/tool-input/wrapper"

describe("OCX wrapper input", () => {
  test("keeps equals signs in values", () => {
    const document = Wrapper.parseWrapper("url=https://example.test?a=b=c")
    expect(Wrapper.value(document, "url")).toBe("https://example.test?a=b=c")
  })

  test("collects repeated keys", () => {
    const document = Wrapper.parseWrapper("playbook=frontend\nplaybook=ui\nrisk=keep assets local")
    expect(Wrapper.values(document, "playbook")).toEqual(["frontend", "ui"])
    expect(Wrapper.values(document, "risk")).toEqual(["keep assets local"])
  })

  test("attaches indented fields and child entities", () => {
    const document = Wrapper.parseWrapper(
      [
        "file=index.html",
        "  owns=document shell",
        "  uses=styles.css",
        "  step=not an entity field",
        "    check=page renders",
      ].join("\n"),
    )
    const file = Wrapper.entities(document, "file")[0]
    expect(file?.value).toBe("index.html")
    expect(Wrapper.values(file, "uses")).toEqual(["styles.css"])
    expect(Wrapper.entities(file, "step")[0]?.value).toBe("not an entity field")
    expect(Wrapper.entities(file, "step")[0] && Wrapper.values(Wrapper.entities(file, "step")[0]!, "check")).toEqual([
      "page renders",
    ])
  })

  test("normalizes readable and compact aliases and preserves extras", () => {
    const document = Wrapper.parseWrapper("goal=build it\nws=visual\nacceptance=page loads\ncustom=value")
    expect(Wrapper.value(document, "goal")).toBe("build it")
    expect(Wrapper.entities(document, "workstream")[0]?.value).toBe("visual")
    expect(Wrapper.values(document, "check")).toEqual(["page loads"])
    expect(document.extras.custom).toEqual(["value"])
  })

  test("reports all missing required fields together", () => {
    const errors = Wrapper.requireKeys(Wrapper.parseWrapper("operation=build"), ["goal", "file", "check"])
    expect(errors.map((error) => error.key)).toEqual(["goal", "file", "check"])
    expect(Wrapper.formatInputErrors(errors, "goal=...\nfile=...\ncheck=...")).toContain("missing=goal,file,check")
  })

  test("normalizes compact protocol aliases used by checkpoints", () => {
    const document = Wrapper.parseWrapper("st=completed\nev=proof\nck=check\nnx=next\nph=verify")
    expect(Wrapper.value(document, "status")).toBe("completed")
    expect(Wrapper.value(document, "evidence")).toBe("proof")
    expect(Wrapper.value(document, "check")).toBe("check")
    expect(Wrapper.value(document, "next")).toBe("next")
    expect(Wrapper.value(document, "phase")).toBe("verify")
  })

  test("deduplicates repeated missing keys in error output", () => {
    const output = Wrapper.formatInputErrors(
      [
        { key: "workstream", message: "missing" },
        { key: "workstream", message: "still missing" },
      ],
      "workstream=runtime",
    )
    expect(output).toContain("missing=workstream")
    expect(output).not.toContain("missing=workstream,workstream")
  })

  test("does not split prose values that mention key-like text", () => {
    const document = Wrapper.parseWrapper("goal=Preserve workflow=codegen semantics")
    expect(Wrapper.value(document, "goal")).toBe("Preserve workflow=codegen semantics")
    expect(Wrapper.value(document, "workflow")).toBeUndefined()
  })

  test("accepts multiple known key-value fields on one physical line", () => {
    const document = Wrapper.parseWrapper(
      "topic=transient-house workflow=codegen phase=context intent=build-modern-page risk=assets-local",
    )
    expect(Wrapper.value(document, "topic")).toBe("transient-house")
    expect(Wrapper.value(document, "workflow")).toBe("codegen")
    expect(Wrapper.value(document, "phase")).toBe("context")
    expect(Wrapper.value(document, "intent")).toBe("build-modern-page")
    expect(Wrapper.entities(document, "risk")[0]?.value).toBe("assets-local")
  })

  test("accepts compact progress fields on one physical line", () => {
    const document = Wrapper.parseWrapper(
      "goal=Build transient house page ws=contract sp=write-contract st=completed ck=contract recorded ev=repo empty nx=download assets",
    )
    expect(Wrapper.value(document, "goal")).toBe("Build transient house page")
    expect(Wrapper.entities(document, "workstream")[0]?.value).toBe("contract")
    expect(Wrapper.entities(document, "step")[0]?.value).toBe("write-contract")
    expect(Wrapper.value(document, "status")).toBe("completed")
    expect(Wrapper.value(document, "check")).toBe("contract recorded")
    expect(Wrapper.value(document, "evidence")).toBe("repo empty")
    expect(Wrapper.value(document, "next")).toBe("download assets")
  })

  test("normalizes common weak-model plural and boundary aliases", () => {
    const document = Wrapper.parseWrapper("non-goals=no backend\nboundaries=local only\nchecks=page renders")
    expect(Wrapper.value(document, "nonGoals")).toBe("no backend")
    expect(Wrapper.value(document, "constraint")).toBe("local only")
    expect(Wrapper.value(document, "check")).toBe("page renders")
  })

})
