import { describe, expect, test } from "bun:test"
import { ArtifactVerifier } from "../../src/ocx/artifact-verifier"
import { tmpdir } from "../fixture/fixture"

describe("OCX artifact verifier", () => {
  test("catches the Inkling failure cluster deterministically", async () => {
    await using temp = await tmpdir({
      init: async (directory) => {
        await Bun.write(
          `${directory}/index.html`,
          [
            '<a href="#">The Red Cabin</a>',
            '<blockquote>Wonderful stay</blockquote><cite>— Mara, Lisbon</cite>',
            '<script>addEventListener("scroll", () => requestAnimationFrame(() => el.style.transform = "translateY(2px)"))</script>',
          ].join("\\n"),
        )
        await Bun.write(`${directory}/assets/unused.jpg`, "not-an-image-but-unused")
        await Bun.write(`${directory}/assets/fonts/bad.ttf`, "<html>download failed</html>")
      },
    })

    const findings = ArtifactVerifier.verify({
      cwd: temp.path,
      changed: ["index.html"],
      reply: "Responsive layout verified and works.",
      userPrompt: "Create a landing page.",
      toolEvidence: [{ name: "audit", completed: true, hasEvidence: true }],
    })
    const ids = findings.map((item) => item.id)
    expect(ids).toContain("UI-DEAD-LINK")
    expect(ids).toContain("UI-UNVERIFIED-TESTIMONIAL")
    expect(ids).toContain("UI-REDUCED-MOTION")
    expect(ids).toContain("UI-INVALID-FONT-ASSET")
    expect(ids).toContain("UI-UNUSED-ASSET")
    expect(ids).toContain("UI-VISUAL-CLAIM-WITHOUT-EVIDENCE")
  })

  test("accepts valid font signatures and real visual authority", async () => {
    await using temp = await tmpdir({
      init: async (directory) => {
        await Bun.write(
          `${directory}/index.html`,
          [
            '<a href="/stays/red-cabin">The Red Cabin</a>',
            '<style>@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }</style>',
            '<style>a:focus-visible { outline: 2px solid currentColor; }</style>',
            '<script>requestAnimationFrame(() => {})</script>',
            '<link rel="preload" href="assets/fonts/site.woff2">',
          ].join("\\n"),
        )
        await Bun.write(`${directory}/assets/fonts/site.woff2`, new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]))
      },
    })

    const findings = ArtifactVerifier.verify({
      cwd: temp.path,
      changed: ["index.html"],
      reply: "Responsive layout verified.",
      userPrompt: "Create a demo landing page.",
      toolEvidence: [{ name: "browser", completed: true, hasEvidence: true }],
    })
    expect(findings).toEqual([])
  })
})
