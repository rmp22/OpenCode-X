import { Effect } from "effect"
import { asc, desc, eq } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable, TodoTable } from "@opencode-ai/core/session/sql"

const glyph = (status: string) => {
  if (status === "completed") return "✓"
  if (status === "in_progress") return "•"
  if (status === "cancelled") return "×"
  return " "
}

export const TodoCommand = effectCmd({
  command: "todo [sessionID]",
  describe: "show the todo list for a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID (default: most recently updated session)",
      type: "string",
    }),
  handler: Effect.fn("Cli.todo")(function* (args) {
    const { db } = yield* Database.Service
    const sessionID =
      args.sessionID ??
      (
        yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .orderBy(desc(SessionTable.time_updated))
          .limit(1)
          .all()
          .pipe(Effect.orDie)
      )[0]?.id
    if (!sessionID) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "No sessions found" + UI.Style.TEXT_NORMAL)
      return
    }
    const rows = yield* db
      .select()
      .from(TodoTable)
      .where(eq(TodoTable.session_id, sessionID))
      .orderBy(asc(TodoTable.position))
      .all()
      .pipe(Effect.orDie)
    if (rows.length === 0) {
      UI.println(`No todos for session ${sessionID}`)
      return
    }
    UI.println(`${UI.Style.TEXT_DIM}todo ${sessionID}${UI.Style.TEXT_NORMAL}`)
    for (const row of rows) {
      UI.println(`[${glyph(row.status)}] (${row.priority}) ${row.content}`)
    }
  }),
})
