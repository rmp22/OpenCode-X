import { Cause, Effect, Exit } from "effect"
import { OCXDb } from "./ocx-db"
import { Recovery } from "./recovery"

export type Input = {
  readonly sessionID: string
  readonly operation: Recovery.Operation
  readonly error: unknown
  readonly store?: OCXDb.Store
}

export function recordFailure(input: Input): Effect.Effect<Recovery.Record, unknown> {
  return record(input, "failed")
}

export function recordCancellation(input: Input): Effect.Effect<Recovery.Record, unknown> {
  return record({ ...input, error: input.error ?? "Operation cancelled" }, "cancelled")
}

export function observe<A, E, R>(
  input: Omit<Input, "error" | "store"> & { readonly store?: OCXDb.Store },
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return effect.pipe(
    Effect.onExit((exit) => {
      if (Exit.isSuccess(exit)) return Effect.void
      const error = Cause.pretty(exit.cause)
      const record = Cause.hasInterruptsOnly(exit.cause) ? recordCancellation : recordFailure
      return record({ ...input, error }).pipe(Effect.ignore)
    }),
  )
}

function record(input: Input, status: "failed" | "cancelled"): Effect.Effect<Recovery.Record, unknown> {
  const recovery = Recovery.create({ operation: input.operation, error: input.error })
  const store = input.store ? Effect.succeed(input.store) : OCXDb.shared
  return store.pipe(
    Effect.map((value) => {
      value.recordOperation({
        sessionID: input.sessionID,
        operation: recovery.operation,
        status,
        category: recovery.category,
        message: recovery.message,
        retryable: recovery.retryable,
        nextAction: recovery.nextAction,
      })
      return recovery
    }),
  )
}

export * as OCXOperation from "./operation"
