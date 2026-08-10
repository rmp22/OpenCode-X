import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import path from "path"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { Tool } from "./tool"
import DESCRIPTION from "./youtube-transcript.txt"

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"])
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/
const SCRIPT_NAME = "youtube-transcript.py"

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTPS YouTube video URL" }),
  language: Schema.String.annotate({ description: "Subtitle language such as en or pt-BR" }).pipe(
    Schema.withDecodingDefault(Effect.succeed("en")),
  ),
})

export function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && YOUTUBE_HOSTS.has(url.hostname.toLowerCase().replace(/\.$/, ""))
  } catch {
    return false
  }
}

function scriptPath() {
  const candidates = [
    path.join(path.dirname(process.execPath), SCRIPT_NAME),
    fileURLToPath(new URL(`./${SCRIPT_NAME}`, import.meta.url)),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function pythonExecutable() {
  return process.platform === "win32" ? "python" : "python3"
}

function validate(params: Schema.Schema.Type<typeof Parameters>) {
  if (!isYouTubeUrl(params.url)) throw new Error("URL must be an HTTPS YouTube URL")
  if (!LANGUAGE_PATTERN.test(params.language)) throw new Error("Language must be a short code such as en or pt-BR")
}

export const YoutubeTranscriptTool = Tool.define<typeof Parameters, { language: string }, ChildProcessSpawner>(
  "youtube-transcript",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          validate(params)
          const script = scriptPath()
          if (!script) throw new Error(`Bundled helper not found: ${SCRIPT_NAME}`)

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: { url: params.url, language: params.language },
          })

          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(
                ChildProcess.make(pythonExecutable(), [script, params.url, params.language], {
                  extendEnv: true,
                  forceKillAfter: "3 seconds",
                  stdin: "ignore",
                }),
              )
              const [output, error] = yield* Effect.all(
                [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
                { concurrency: 2 },
              )
              const exitCode = yield* handle.exitCode
              return { output, error, exitCode }
            }),
          ).pipe(
            Effect.timeoutOrElse({
              duration: "5 minutes",
              orElse: () => Effect.fail(new Error("YouTube transcript extraction timed out")),
            }),
          )

          if (result.exitCode !== 0) throw new Error(result.error.trim() || "YouTube transcript extraction failed")
          return {
            title: `YouTube transcript ${params.url}`,
            output: result.output.trim(),
            metadata: { language: params.language },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
