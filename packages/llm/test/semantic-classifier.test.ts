import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { ClassifierDefinition, ClassifierID, TaskContext } from "../src/semantic/schemas"
import { ClassifierFailure, ClassifierRunner } from "../src/semantic/classifier"

describe("semantic classifier", () => {
  test("reports a missing model without constructing an invalid LLM request", async () => {
    const definition = new ClassifierDefinition({
      id: ClassifierID.make("semantic.test"),
      version: 1,
      description: "test classifier",
      outputSchema: Schema.Unknown,
      prompt: "Classify this task.",
      modelClass: "fast",
    })
    const exit = await Effect.runPromiseExit(
      ClassifierRunner.make().classify(definition, new TaskContext({ request: "inspect the task" }), Schema.String),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(Cause.squash(exit.cause)).toMatchObject({
      _tag: "Semantic.ClassifierFailure",
      classifierId: "semantic.test",
      message: "A model is required for semantic classification",
    })
  })
  test("retries transient semantic failures before succeeding", async () => {
    let attempts = 0
    const runner = ClassifierRunner.make({
      generateObject: (() => {
        attempts++
        if (attempts < 3) {
          return Effect.fail(
            new ClassifierFailure({
              classifierId: "semantic.retry-test",
              message: "transient provider failure",
              attempt: attempts - 1,
            }),
          )
        }
        return Effect.succeed({ object: "ok" })
      }) as any,
    })
    const definition = new ClassifierDefinition({
      id: ClassifierID.make("semantic.retry-test"),
      version: 1,
      description: "retry test",
      outputSchema: Schema.Unknown,
      prompt: "Classify this task.",
      modelClass: "fast",
      retryPolicy: { maxRetries: 2, backoffMs: 0 },
    })

    const result = await Effect.runPromise(
      runner.classify(
        definition,
        new TaskContext({ request: "inspect the task" }),
        Schema.String,
        { model: {} as any },
      ),
    )

    expect(result).toBe("ok")
    expect(attempts).toBe(3)
  })

  test("uses the declared fallback only after retries are exhausted", async () => {
    let attempts = 0
    const runner = ClassifierRunner.make({
      generateObject: (() => {
        attempts++
        return Effect.fail(
          new ClassifierFailure({
            classifierId: "semantic.fallback-test",
            message: "provider unavailable",
            attempt: attempts - 1,
          }),
        )
      }) as any,
    })
    const definition = new ClassifierDefinition({
      id: ClassifierID.make("semantic.fallback-test"),
      version: 1,
      description: "fallback test",
      outputSchema: Schema.Unknown,
      prompt: "Classify this task.",
      modelClass: "fast",
      retryPolicy: { maxRetries: 1, backoffMs: 0 },
      fallbackPolicy: { enabled: true, fallbackValue: "safe-fallback" },
    })

    const result = await Effect.runPromise(
      runner.classify(
        definition,
        new TaskContext({ request: "inspect the task" }),
        Schema.String,
        { model: {} as any },
      ),
    )

    expect(result).toBe("safe-fallback")
    expect(attempts).toBe(2)
  })

})
