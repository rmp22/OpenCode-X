export type WrapperRecord = {
  readonly key: string
  readonly value: string
  readonly indent: number
}

export type WrapperEntity = {
  readonly key: string
  readonly value: string
  readonly indent: number
  readonly fields: WrapperRecord[]
  readonly children: WrapperEntity[]
}

export type WrapperDocument = {
  readonly records: readonly WrapperRecord[]
  readonly entities: readonly WrapperEntity[]
  readonly extras: Readonly<Record<string, readonly string[]>>
}

export type WrapperError = {
  readonly key: string
  readonly message: string
}

const ENTITY_KEYS = new Set(["file", "workstream", "step", "risk", "check", "target"])
const KNOWN_KEYS = new Set([
  ...ENTITY_KEYS,
  "topic",
  "workflow",
  "phase",
  "playbook",
  "intent",
  "goal",
  "scope",
  "operation",
  "allowedChanges",
  "allowedBreaks",
  "nonGoals",
  "rollbackPlan",
  "principle",
  "rejected",
  "doesNotOwn",
  "uses",
  "importsOrUses",
  "input",
  "output",
  "status",
  "evidence",
  "next",
  "constraint",
  "requirement",
  "dependency",
  "updateWorkstream",
  "addStep",
  "action",
  "path",
  "wrapper",
  "url",
])

const INLINE_SPLIT_KEYS = new Set([
  "topic",
  "workflow",
  "phase",
  "intent",
  "playbook",
  "risk",
  "status",
  "workstream",
  "step",
  "target",
])

const KEY_ALIASES: Record<string, string> = {
  acceptance: "check",
  acceptancecheck: "check",
  acceptancechecks: "check",
  action: "action",
  addstep: "addStep",
  allowedbreaks: "allowedBreaks",
  allowedchanges: "allowedChanges",
  constraint: "constraint",
  dependency: "dependency",
  dep: "dependency",
  doesnotown: "doesNotOwn",
  evidence: "evidence",
  ev: "evidence",
  file: "file",
  filepath: "path",
  g: "goal",
  goal: "goal",
  importsoruses: "importsOrUses",
  next: "next",
  nx: "next",
  nextaction: "next",
  nextcheck: "check",
  nongoal: "nonGoals",
  nongoals: "nonGoals",
  boundary: "constraint",
  boundaries: "constraint",
  checks: "check",
  steps: "step",
  objective: "topic",
  op: "operation",
  operation: "operation",
  path: "path",
  pb: "playbook",
  ph: "phase",
  playbook: "playbook",
  reject: "rejected",
  rejected: "rejected",
  rollback: "rollbackPlan",
  rollbackplan: "rollbackPlan",
  sc: "scope",
  scope: "scope",
  sp: "step",
  status: "status",
  st: "status",
  strategy: "playbook",
  tg: "target",
  ck: "check",
  topic: "topic",
  updateworkstream: "updateWorkstream",
  uses: "uses",
  req: "requirement",
  workstream: "workstream",
  ws: "workstream",
}

function keyName(value: string): string {
  const normalized = value.replaceAll(/[_\s-]/g, "").toLowerCase()
  return KEY_ALIASES[normalized] ?? value.trim()
}

function indentOf(value: string): number {
  const prefix = value.match(/^[ \t]*/)?.[0] ?? ""
  return [...prefix].reduce((total, char) => total + (char === "\t" ? 2 : 1), 0)
}

function addExtra(extras: Record<string, string[]>, record: WrapperRecord): void {
  if (KNOWN_KEYS.has(record.key)) return
  const values = extras[record.key] ?? []
  values.push(record.value)
  extras[record.key] = values
}


function logicalLines(input: string): string[] {
  const output: string[] = []
  for (const raw of input.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) {
      output.push(raw)
      continue
    }
    const prefix = raw.match(/^[ \t]*/)?.[0] ?? ""
    const body = raw.slice(prefix.length)
    const matches = [...body.matchAll(/(?:^|\s+)([A-Za-z][A-Za-z0-9_-]*)=/g)]
      .map((match) => ({
        index: match.index ?? 0,
        key: keyName(match[1] ?? ""),
      }))
      .filter((match) => KNOWN_KEYS.has(match.key))
    if (matches.length <= 1) {
      output.push(raw)
      continue
    }

    // Weak/cheap models frequently emit compact scalar wrappers on one physical
    // line. Split every recognized key=value boundary in that case. Preserve
    // the common prose case `goal=Preserve workflow=coding semantics`: with
    // exactly two assignments, a trailing multi-word value is more likely prose
    // than a second wrapper field. Hierarchical tools should still prefer lines.
    if (matches.length == 2) {
      const second = matches[1]!
      const secondValue = body.slice(second.index).split("=", 2)[1]?.trim() ?? ""
      if (!INLINE_SPLIT_KEYS.has(matches[0]!.key) && /\s/.test(secondValue)) {
        output.push(raw)
        continue
      }
    }
    for (let index = 0; index < matches.length; index++) {
      const current = matches[index]!
      const next = matches[index + 1]
      const start = current.index + (body[current.index] === " " ? 1 : 0)
      const end = next?.index ?? body.length
      output.push(prefix + body.slice(start, end).trim())
    }
  }
  return output
}

export function parseWrapper(input: string): WrapperDocument {
  const records: WrapperRecord[] = []
  const entities: WrapperEntity[] = []
  const extras: Record<string, string[]> = {}
  const stack: WrapperEntity[] = []

  for (const line of logicalLines(input)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator < 0) continue
    const key = keyName(line.slice(0, separator).trim())
    if (!key) continue
    const record: WrapperRecord = {
      key,
      value: line.slice(separator + 1).trim(),
      indent: indentOf(line),
    }

    if (ENTITY_KEYS.has(key)) {
      while (stack.length > 0 && stack[stack.length - 1]!.indent >= record.indent) stack.pop()
      const entity: WrapperEntity = { key, value: record.value, indent: record.indent, fields: [], children: [] }
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(entity)
      else entities.push(entity)
      stack.push(entity)
      continue
    }

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= record.indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.fields.push(record)
    else records.push(record)
    addExtra(extras, record)
  }

  return { records, entities, extras }
}

export function value(input: WrapperDocument | WrapperEntity | undefined, key: string): string | undefined {
  return values(input, key)[0]
}

export function values(input: WrapperDocument | WrapperEntity | undefined, key: string): string[] {
  if (!input) return []
  const canonical = keyName(key)
  const records = "records" in input ? input.records : input.fields
  const values = records.filter((record) => record.key === canonical && record.value.length > 0).map((record) => record.value)
  const children = "entities" in input ? input.entities : input.children
  values.push(...children.filter((entity) => entity.key === canonical).map((entity) => entity.value))
  return values
}

export function entities(input: WrapperDocument | WrapperEntity | undefined, key: string): WrapperEntity[] {
  if (!input) return []
  const canonical = keyName(key)
  const children = "entities" in input ? input.entities : input.children
  return children.filter((entity) => entity.key === canonical && entity.value.length > 0)
}

export function requireKeys(input: WrapperDocument, keys: readonly string[]): WrapperError[] {
  return [...new Set(keys.map(keyName))].flatMap((key) => {
    const present = ENTITY_KEYS.has(key) ? entities(input, key).length > 0 : values(input, key).length > 0
    return present ? [] : [{ key, message: `missing required field '${key}'` }]
  })
}

export function formatInputErrors(errors: readonly WrapperError[], example: string): string {
  const keys = [...new Set(errors.map((error) => error.key))]
  return ["INPUT_INVALID", `missing=${keys.join(",")}`, "example=", example].join("\n")
}

export function canonicalKey(value: string): string {
  return keyName(value)
}

export * as Wrapper from "./wrapper"
