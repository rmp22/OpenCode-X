import { Effect } from "effect"
import { AgentMemory } from "../../src/ocx/agent-memory"

const databasePath = process.argv[2]
const sessionID = process.argv[3]
const marker = process.argv[4]
if (!databasePath || !sessionID || !marker) throw new Error("database path, session ID, and marker are required")

const store = await Effect.runPromise(AgentMemory.open(databasePath))
store.set(sessionID, {
  workdir: "/tmp",
  objective: marker,
  scope: marker,
  phase: marker,
  completed: [marker],
  evidence: [marker],
  corrections: [marker],
  nextAction: marker,
  nextCheck: marker,
})
