import type { StrategyName } from "@/ocx/strategy"
import { Strategy } from "@/ocx/strategy"
import { createHash } from "node:crypto"

export type PlaybookStage = "pre_implementation" | "post_implementation" | "verification" | "recovery"
export type ExecutionStage =
  | "none"
  | "pre_implementation"
  | "implementation"
  | "post_implementation"
  | "verification"
  | "recovery"

export type PlaybookStageState = {
  readonly stage: ExecutionStage
  readonly revision: number
  readonly previousStage?: ExecutionStage
  readonly selectionRevision?: string
  readonly passes?: readonly PlaybookPassRecord[]
}

export type PlaybookPassRecord = {
  readonly playbookID: StrategyName
  readonly stage: PlaybookStage
  readonly hash: string
  readonly selectionRevision: string
  readonly outcome: "completed" | "failed" | "skipped" | "cancelled" | "invalidated"
  readonly reason?: string
}

export type CatalogEntry = {
  readonly id: StrategyName
  readonly purpose: string
  readonly trigger: string
  readonly stage: PlaybookStage
  readonly hash: string
}

const STAGE_MAP: Record<string, PlaybookStage> = {
  frontend: "pre_implementation",
  typescript: "pre_implementation",
  python: "pre_implementation",
  rust: "pre_implementation",
  go: "pre_implementation",
  java: "pre_implementation",
  kotlin: "pre_implementation",
  cpp: "pre_implementation",
  swift: "pre_implementation",
  android: "pre_implementation",
  compose: "pre_implementation",
  ui: "pre_implementation",
  "web-design": "pre_implementation",
  fonts: "pre_implementation",
  web: "pre_implementation",
  stack: "pre_implementation",
  structure: "post_implementation",
  engineering: "pre_implementation",
  write: "pre_implementation",
  frontier: "pre_implementation",
  exemplars: "pre_implementation",
  memory: "pre_implementation",
  think: "pre_implementation",
  browser: "verification",
  build: "verification",
  review: "verification",
  audit: "verification",
  quality: "post_implementation",
  complexity: "post_implementation",
  reasoning: "recovery",
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}

export function defaultStage(name: StrategyName): PlaybookStage {
  return STAGE_MAP[name] ?? "pre_implementation"
}

export const VISUAL_TRIGGER_PATTERN = /\b(?:frontend|ui|web|page|screen|layout|style|landing|visual|responsive|browser)\b/i
export const CODING_TRIGGER_PATTERN = /\b(?:code|coding|implement|refactor|fix|bug|module|function|typescript|javascript)\b/i

export function requiredBaselines(input: {
  readonly prompt?: string
  readonly topic?: string
  readonly strategies?: readonly StrategyName[]
  readonly coding?: boolean
}): StrategyName[] {
  const selected = new Set<StrategyName>(input.strategies ?? [])
  const text = `${input.topic ?? ""}\n${input.prompt ?? ""}`
  const visual = VISUAL_TRIGGER_PATTERN.test(text)
  const coding = input.coding === true || CODING_TRIGGER_PATTERN.test(text)
  const required: StrategyName[] = []
  const add = (name: StrategyName) => {
    if (selected.has(name)) return
    selected.add(name)
    required.push(name)
  }
  if (visual) {
    add("frontend")
    add("ui")
    add("web-design")
    add("fonts")
    add("audit")
    add("browser")
  }
  if (coding) {
    add("engineering")
    if (visual || input.strategies?.includes("structure")) add("structure")
  }
  return required
}

let cachedEntries: CatalogEntry[] | undefined
let cachedCatalogText: string | undefined

export function catalogEntries(): CatalogEntry[] {
  if (cachedEntries) return cachedEntries
  cachedEntries = Strategy.STRATEGY_NAMES.map((name) => {
    const content = Strategy.load(name) ?? ""
    const entry = {
      id: name,
      purpose: strategiesPurpose(name),
      trigger: strategiesTrigger(name),
      stage: defaultStage(name),
      hash: hashContent(content),
    }
    return entry
  })
  return cachedEntries
}

export function invalidateCache(): void {
  cachedEntries = undefined
  cachedCatalogText = undefined
}

function strategiesPurpose(name: StrategyName): string {
  const catalog = Strategy.catalog()
  const line = catalog.split("\n").find((l) => l.startsWith(`- ${name}:`))
  if (!line) return ""
  const match = line.match(/^- \S+: (.*?)\. Load when:/)
  return match?.[1]?.trim() ?? ""
}

function strategiesTrigger(name: StrategyName): string {
  const catalog = Strategy.catalog()
  const line = catalog.split("\n").find((l) => l.startsWith(`- ${name}:`))
  if (!line) return ""
  const match = line.match(/Load when: (.*)\.$/)
  return match?.[1]?.trim() ?? ""
}

export function metadataCatalog(): string {
  return catalogEntries()
    .map((entry) => `- ${entry.id} [${entry.stage}]: ${entry.purpose}. Load when: ${entry.trigger}.`)
    .join("\n")
}

export function hashFor(name: StrategyName): string {
  const content = Strategy.load(name) ?? ""
  return hashContent(content)
}

export function loadBody(name: StrategyName): string | undefined {
  return Strategy.load(name)
}

export * as PlaybookCatalog from "./catalog"
