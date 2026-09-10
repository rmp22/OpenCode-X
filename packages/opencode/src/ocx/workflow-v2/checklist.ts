import { Db } from "./db"

export type ChecklistItemStatus = "pending" | "pass" | "fail" | "skipped"

export type ChecklistVerdict = "pending" | "pass" | "fail" | "recycled"

export type ChecklistItem = {
  readonly id: string
  readonly name: string
  readonly status: ChecklistItemStatus
  readonly checkCommand?: string
  readonly evidence?: string
  readonly reason?: string
}

export type ChecklistRun = {
  readonly id: string
  readonly laneID: string
  readonly checklistID: string
  readonly verdict: ChecklistVerdict
  readonly items: readonly ChecklistItem[]
  readonly createdAt: number
}

export const DEFAULT_SIGN_OUT_AUDIT_ITEMS: readonly ChecklistItem[] = [
  { id: "diff-vs-request", name: "Diff matches requested changes", status: "pending" },
  { id: "typecheck", name: "TypeScript static checks pass cleanly", status: "pending", checkCommand: "bun typecheck" },
  { id: "tests", name: "Relevant test suites pass", status: "pending", checkCommand: "bun test" },
  { id: "lint", name: "Lint and code style checks pass", status: "pending" },
  { id: "protected-paths", name: "No protected or sensitive paths modified", status: "pending" },
  { id: "secrets", name: "No unredacted secrets or credentials", status: "pending" },
]

export function loadProjectChecklist(customCatalog?: readonly ChecklistItem[]): readonly ChecklistItem[] {
  if (customCatalog && customCatalog.length > 0) {
    return customCatalog.map((item) => ({ ...item }))
  }
  return DEFAULT_SIGN_OUT_AUDIT_ITEMS.map((item) => ({ ...item }))
}

export function createChecklistRun(
  laneID: string,
  checklistID = "sign-out-audit",
  customItems?: readonly ChecklistItem[],
): ChecklistRun {
  const id = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const items = customItems
    ? customItems.map((item) => ({ ...item }))
    : DEFAULT_SIGN_OUT_AUDIT_ITEMS.map((item) => ({ ...item }))

  const run: ChecklistRun = {
    id,
    laneID,
    checklistID,
    verdict: "pending",
    items,
    createdAt: Date.now(),
  }

  Db.insertChecklistRun({
    id: run.id,
    lane_id: run.laneID,
    checklist_id: run.checklistID,
    verdict: run.verdict,
    items: run.items,
    created_at: run.createdAt,
  })

  return run
}

export function updateChecklistItem(
  runID: string,
  itemID: string,
  result: { pass: boolean; evidence?: string; reason?: string },
): ChecklistRun | undefined {
  const run = Db.getChecklistRun(runID)
  if (!run) return undefined

  const rawItems = Array.isArray(run.items) ? (run.items as ChecklistItem[]) : []
  const items = rawItems.map((item) => {
    if (item.id !== itemID) return item
    return {
      ...item,
      status: (result.pass ? "pass" : "fail") as ChecklistItemStatus,
      evidence: result.evidence,
      reason: result.reason,
    }
  })

  const hasFailing = items.some((item) => item.status === "fail")
  const allCompleted = items.every((item) => item.status === "pass" || item.status === "skipped")
  const verdict: ChecklistVerdict = hasFailing ? "fail" : allCompleted ? "pass" : "pending"

  Db.insertChecklistRun({
    ...run,
    verdict,
    items,
  })

  return {
    id: run.id,
    laneID: run.lane_id,
    checklistID: run.checklist_id,
    verdict,
    items,
    createdAt: run.created_at,
  }
}

export function evaluateChecklistRun(runID: string): {
  verdict: ChecklistVerdict
  failingItems: ChecklistItem[]
  pendingItems: ChecklistItem[]
  run?: ChecklistRun
} {
  const run = Db.getChecklistRun(runID)
  if (!run) {
    return { verdict: "pending", failingItems: [], pendingItems: [] }
  }

  const items = Array.isArray(run.items) ? (run.items as ChecklistItem[]) : []
  const failingItems = items.filter((item) => item.status === "fail")
  const pendingItems = items.filter((item) => item.status === "pending")
  const verdict: ChecklistVerdict =
    failingItems.length > 0 ? "fail" : pendingItems.length === 0 ? "pass" : "pending"

  return {
    verdict,
    failingItems,
    pendingItems,
    run: {
      id: run.id,
      laneID: run.lane_id,
      checklistID: run.checklist_id,
      verdict,
      items,
      createdAt: run.created_at,
    },
  }
}

export function getChecklistRun(runID: string): ChecklistRun | undefined {
  const run = Db.getChecklistRun(runID)
  if (!run) return undefined
  return {
    id: run.id,
    laneID: run.lane_id,
    checklistID: run.checklist_id,
    verdict: run.verdict as ChecklistVerdict,
    items: Array.isArray(run.items) ? (run.items as ChecklistItem[]) : [],
    createdAt: run.created_at,
  }
}

export * as Checklist from "./checklist"
