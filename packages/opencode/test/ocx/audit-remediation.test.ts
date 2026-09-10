import { describe, expect, test } from "bun:test"
import { ArtifactVerifier } from "../../src/ocx/artifact-verifier"
import { OCXGate } from "../../src/ocx/slop-gate"
import { tmpdir } from "../fixture/fixture"

describe("OCX audit remediations", () => {
  test("flags missing referenced image assets deterministically", async () => {
    await using temp = await tmpdir({
      init: async (directory) => {
        await Bun.write(
          `${directory}/index.html`,
          [
            '<!DOCTYPE html><html><body>',
            '<img src="assets/photos/tech_chip.jpg" alt="Missing chip">',
            '<img src="assets/photos/existing.jpg" alt="Existing photo">',
            '</body></html>',
          ].join("\n"),
        )
        await Bun.write(`${directory}/assets/photos/existing.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))
      },
    })

    const findings = ArtifactVerifier.verify({
      cwd: temp.path,
      changed: ["index.html"],
      reply: "Page verified.",
      userPrompt: "Create a tech landing page.",
      toolEvidence: [{ name: "browser", completed: true, hasEvidence: true }],
    })
    const ids = findings.map((item) => item.id)
    expect(ids).toContain("UI-MISSING-ASSET")
    const missingFinding = findings.find((f) => f.id === "UI-MISSING-ASSET")
    expect(missingFinding?.message).toContain("assets/photos/tech_chip.jpg")
  })

  test("flags tech AI slop slogans in web copy", async () => {
    await using temp = await tmpdir({
      init: async (directory) => {
        await Bun.write(
          `${directory}/index.html`,
          [
            '<!DOCTYPE html><html><body>',
            '<h1>The Phone That Thinks</h1>',
            '<p>Not a tool. A partner.</p>',
            '<h2>Built for Intelligence.</h2>',
            '</body></html>',
          ].join("\n"),
        )
      },
    })

    const findings = ArtifactVerifier.verify({
      cwd: temp.path,
      changed: ["index.html"],
      reply: "Landing page done.",
      userPrompt: "Create tech landing page",
      toolEvidence: [{ name: "browser", completed: true, hasEvidence: true }],
    })
    const ids = findings.map((item) => item.id)
    expect(ids).toContain("UI-AI-SLOP-COPY")
  })

  test("slop gate scans tool-written file inputs", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "Create landing page" }] },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I have written the file." },
          {
            type: "tool",
            state: {
              status: "completed",
              input: {
                filePath: "index.html",
                content: `
                  <a href="#">Dead link 1</a>
                  <a href="#">Dead link 2</a>
                  <p>Your message has been sent successfully. We will get back to you within 24 hours.</p>
                `,
              },
            },
          },
        ],
      },
    ]

    const directive = OCXGate.gateDirectiveFromMessages(messages as any)
    expect(directive).toBeDefined()
    expect(directive).toContain("=== OCX OUTPUT GATE ===")
    expect(directive).toContain("DEAD_LINKS")
    expect(directive).toContain("FAKE_SUCCESS")
  })
})
