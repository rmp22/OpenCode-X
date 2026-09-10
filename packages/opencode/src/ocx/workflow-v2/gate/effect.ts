import { Deferred, Duration, Effect } from "effect"
import type { ActionEffect } from "../risk"
import type { GateRecord, GateResolution } from "./index"
import { mintGate, registerGateWaiter, unregisterGateWaiter } from "./index"

export class GateTimeoutError {
  readonly _tag = "GateTimeoutError"
  constructor(readonly gateID: string, readonly timeoutMs: number) {}
}

export class GateRejectedError {
  readonly _tag = "GateRejectedError"
  constructor(readonly gateID: string, readonly reason: string) {}
}

export function awaitGateResolution(
  gate: GateRecord,
  timeoutMs = 600_000,
): Effect.Effect<GateResolution, GateTimeoutError | GateRejectedError> {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<GateResolution>()
    registerGateWaiter(gate.id, (resolution) => {
      Deferred.doneUnsafe(deferred, Effect.succeed(resolution))
    })

    const timeoutEffect = Effect.delay(
      Effect.fail(new GateTimeoutError(gate.id, timeoutMs)),
      Duration.millis(timeoutMs),
    )

    const resolution = yield* Effect.race(
      Deferred.await(deferred),
      timeoutEffect,
    ).pipe(
      Effect.ensuring(Effect.sync(() => unregisterGateWaiter(gate.id))),
    )

    if (resolution.decision === "kill") {
      return yield* Effect.fail(new GateRejectedError(gate.id, resolution.rawAnswer))
    }
    return resolution
  })
}

export function executeWithGate<A, E, R>(
  laneID: string,
  effectType: ActionEffect,
  payload: Record<string, unknown>,
  action: () => Effect.Effect<A, E, R>,
  onPauseLane?: (laneID: string, gate: GateRecord) => void,
  onResumeLane?: (laneID: string) => void,
): Effect.Effect<A, E | GateTimeoutError | GateRejectedError, R> {
  if (effectType !== "blast-radius" && effectType !== "protected") {
    return action()
  }

  return Effect.gen(function* () {
    const gate = mintGate({ laneID, effect: effectType, payload })
    if (onPauseLane) {
      onPauseLane(laneID, gate)
    }

    yield* awaitGateResolution(gate)

    if (onResumeLane) {
      onResumeLane(laneID)
    }

    return yield* action()
  })
}

export * as GateEffect from "./effect"
