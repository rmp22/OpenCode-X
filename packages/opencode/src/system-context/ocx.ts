import { SystemContext } from "@opencode-ai/core/system-context"
import { Effect, Schema } from "effect"
import { OCXDb } from "@/ocx/ocx-db"
import { TrustBoundary } from "@/ocx/trust-boundary"

export type Input = {
  readonly store: OCXDb.Store
  readonly sessionID: string
  readonly repositoryID: string
}

export type ContextResult = {
  readonly text?: string
  readonly snapshot: SystemContext.Snapshot
}

const stringCodec = Schema.toCodecJson(Schema.String)

function serialize(value: unknown, limit = 1_600): string {
  if (value === undefined) return "none"
  const raw = JSON.stringify(value) ?? "none"
  return raw.length > limit ? raw.slice(0, limit) + "...[truncated]" : raw
}

function source(key: string, label: string, load: () => unknown, limit?: number) {
  return SystemContext.make({
    key: SystemContext.Key.make(`ocx/${key}`),
    codec: stringCodec,
    load: Effect.sync(() => serialize(load(), limit)),
    baseline: (value) => TrustBoundary.block(label, "system", value),
    update: (_previous, value) => TrustBoundary.block(`${label} update`, "system", value),
  })
}

export function create(input: Input): SystemContext.SystemContext {
  const verificationIDs = () => input.store.verifications(input.sessionID, 5).map((record) => record.id)
  const links = () => verificationIDs().flatMap((id) => input.store.links(id, 2)).slice(0, 8)
  return SystemContext.combine([
    source("workflow", "OCX workflow state", () => input.store.get(input.sessionID), 2_400),
    source("requirements", "OCX requirement state", () => input.store.getRequirementLedger(input.repositoryID).slice(0, 8), 1_200),
    source("graph", "OCX task graph state", () => input.store.getGraph(input.repositoryID), 1_600),
    source("evidence", "OCX verification evidence", () => input.store.verifications(input.sessionID, 5), 1_200),
    source("links", "OCX provenance links", links, 800),
  ])
}

export function render(input: Input & { readonly snapshot?: SystemContext.Snapshot }): Effect.Effect<ContextResult> {
  const context = create(input)
  const previous = input.snapshot
  if (!previous)
    return SystemContext.initialize(context).pipe(
      Effect.map((generation) => ({ text: generation.baseline, snapshot: generation.snapshot })),
      Effect.catch(() => Effect.succeed<ContextResult>({ snapshot: {} })),
    )

  return SystemContext.reconcile(context, input.snapshot).pipe(
    Effect.map((result): ContextResult => {
      if (result._tag === "Updated") return { text: result.text, snapshot: result.snapshot }
      if (result._tag === "ReplacementReady") return { text: result.generation.baseline, snapshot: result.generation.snapshot }
      if (result._tag === "ReplacementBlocked") return { snapshot: previous }
      return { snapshot: previous }
    }),
    Effect.catch(() => Effect.succeed<ContextResult>({ snapshot: previous })),
  )
}

export * as OCXSystemContext from "./ocx"
