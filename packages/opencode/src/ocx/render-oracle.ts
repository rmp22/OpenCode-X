export type RenderPlan = {
  readonly entry: string
  readonly viewports: readonly number[]
  readonly waitMs: number
  readonly asserts: readonly string[]
}

export type RenderFinding = {
  readonly id: string
  readonly message: string
  readonly span?: string
}

export type Capture = {
  readonly viewport: number
  readonly shotPath?: string
  readonly consoleErrors: readonly string[]
  readonly failedRequests: readonly string[]
  readonly overflowX?: boolean
  readonly textHidden?: readonly string[]
  readonly unavailable?: string
}

const WEB_ARTIFACT = /\.(?:html?|css)$/i
const VIEWPORTS = [375, 768, 1440] as const

export function maxAnimationMs(css: string): number {
  let max = 0
  for (const match of css.matchAll(/animation\s*:([^;}{]+)/gi)) {
    const times = [...match[1]!.matchAll(/(\d+(?:\.\d+)?)\s*(m?s)/gi)].map((item) =>
      item[2]!.toLowerCase() === "ms" ? Number(item[1]) : Number(item[1]) * 1000,
    )
    const total = times.slice(0, 2).reduce((sum, value) => sum + value, 0)
    if (total > max) max = total
  }
  if (max === 0) return 1200
  return Math.min(6000, Math.max(800, max + 400))
}

export function planRender(entry: string, css: string, changedPaths: readonly string[]): RenderPlan | undefined {
  if (!changedPaths.some((changed) => WEB_ARTIFACT.test(changed))) return undefined
  return {
    entry,
    viewports: [...VIEWPORTS],
    waitMs: maxAnimationMs(css),
    asserts: ["no horizontal overflow at any viewport", "hero text bounding boxes are non-empty after waitMs", "no console errors or failed requests"],
  }
}

export function evaluateCaptures(captures: readonly Capture[]): RenderFinding[] {
  const findings: RenderFinding[] = []
  for (const capture of captures) {
    if (capture.unavailable) {
      findings.push({
        id: "RENDER-UNAVAILABLE",
        message: `viewport ${capture.viewport}: render unavailable (${capture.unavailable}); report visual status as unverified`,
      })
      continue
    }
    for (const error of capture.consoleErrors)
      findings.push({ id: "RENDER-CONSOLE-ERROR", message: `viewport ${capture.viewport}: console error: ${error.slice(0, 200)}` })
    for (const failed of capture.failedRequests)
      findings.push({ id: "RENDER-FAILED-REQUEST", message: `viewport ${capture.viewport}: failed request: ${failed.slice(0, 200)}` })
    if (capture.overflowX)
      findings.push({ id: "RENDER-OVERFLOW-X", message: `viewport ${capture.viewport}: horizontal overflow detected; fix layout instead of hiding it` })
    for (const selector of capture.textHidden ?? [])
      findings.push({
        id: "RENDER-TEXT-HIDDEN",
        message: `viewport ${capture.viewport}: expected text ${selector} has an empty bounding box after the animation wait; check fill modes and overlays`,
        span: selector,
      })
  }
  return findings
}

export async function captureStatic(
  entryFile: string,
  outDir: string,
  viewports: readonly number[] = [...VIEWPORTS],
): Promise<Capture[]> {
  const browser = Bun.which("firefox") ?? Bun.which("chromium") ?? Bun.which("chromium-browser") ?? Bun.which("google-chrome")
  if (!browser)
    return viewports.map((viewport) => ({ viewport, consoleErrors: [], failedRequests: [], unavailable: "no headless browser on PATH" }))
  const captures: Capture[] = []
  for (const viewport of viewports) {
    const shotPath = `${outDir}/render-${viewport}.png`
    try {
      const proc = Bun.spawnSync([browser, "--headless", "--screenshot", shotPath, "--window-size", `${viewport},900`, entryFile], {
        timeout: 60_000,
      })
      captures.push({
        viewport,
        consoleErrors: [],
        failedRequests: [],
        ...(proc.exitCode === 0 ? { shotPath } : { unavailable: `browser exited with code ${proc.exitCode}` }),
      })
    } catch (error) {
      captures.push({
        viewport,
        consoleErrors: [],
        failedRequests: [],
        unavailable: error instanceof Error ? error.message : "browser launch failed",
      })
    }
  }
  return captures
}

export * as RenderOracle from "./render-oracle"
