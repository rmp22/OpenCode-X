import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import path from "path"
import { Parameters, isYouTubeUrl } from "../../src/tool/youtube-transcript"

const script = path.resolve(import.meta.dir, "../../src/tool/youtube-transcript.py")

describe("youtube-transcript", () => {
  test("accepts YouTube HTTPS URLs and defaults to English", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=video")).toBe(true)
    expect(isYouTubeUrl("https://youtu.be/video")).toBe(true)
    expect(isYouTubeUrl("http://www.youtube.com/watch?v=video")).toBe(false)
    expect(isYouTubeUrl("https://example.com/video")).toBe(false)
    expect(Schema.decodeUnknownSync(Parameters)({ url: "https://youtu.be/video" })).toEqual({
      url: "https://youtu.be/video",
      language: "en",
    })
  })

  test("strips SRT metadata, markup, and repeated caption lines", async () => {
    const process = Bun.spawn(
      [
        "python3",
        "-c",
        'import runpy, sys; module = runpy.run_path(sys.argv[1]); print(module["strip_srt"](sys.stdin.read()))',
        script,
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    )
    process.stdin.write(
      [
        "1",
        "00:00:00,000 --> 00:00:01,000",
        "<b>Hello</b>",
        "",
        "2",
        "00:00:01,000 --> 00:00:02,000",
        "Hello",
        "",
        "3",
        "00:00:02,000 --> 00:00:03,000",
        "World",
        "",
      ].join("\n"),
    )
    process.stdin.end()
    const [output, error, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])

    expect(exitCode).toBe(0)
    expect(error).toBe("")
    expect(output).toBe("Hello\nWorld\n")
  })
})
