export type StaticCheckSeverity = "error" | "warning"

export type StaticCheckCode =
  | "ERR_NULL_BYTE"
  | "ERR_JSON_SYNTAX"
  | "ERR_BRACKET_IMBALANCE"
  | "ERR_XML_TAG_MISMATCH"
  | "ERR_DEAD_CODE"
  | "ERR_NOOP_CODE"
  | "ERR_UNWIRED_CODE"
  | "ERR_ORPHAN_VARIABLE"
  | "ERR_EMPTY_CATCH"
  | "ERR_DEBUG_LEFTOVER"
  | "ERR_FQN_USAGE"
  | "ERR_AI_SLOP_COMMENT"
  | "ERR_UNRESOLVED_SYMBOL"
  | "ERR_UNUSED_IMPORT"
  | "WARN_MIXED_LINE_ENDINGS"
  | "WARN_TRAILING_WHITESPACE"
  | "WARN_NO_TRAILING_NEWLINE"

export interface StaticCheckFinding {
  readonly code: StaticCheckCode
  readonly severity: StaticCheckSeverity
  readonly message: string
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly symbol?: string
  readonly fixSuggestion?: string
  readonly callerPerimeter?: readonly string[]
  readonly enclosingScope?: string
}

export interface StaticCheckResult {
  readonly passed: boolean
  readonly filePath: string
  readonly language: string
  readonly findings: readonly StaticCheckFinding[]
}

export interface StaticChecksOptions {
  readonly previousContent?: string
}

const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  css: "css",
  scss: "scss",
  less: "less",
  dart: "dart",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  jl: "julia",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  clj: "clojure",
  ktm: "kotlin",
  m: "objc",
  mm: "objc",
  groovy: "groovy",
  gradle: "gradle",
  tf: "terraform",
  dockerfile: "dockerfile",
}

const PROSE_EXTENSIONS = new Set(["md", "markdown", "rst", "txt", "adoc", "tex"])

export function detectStaticLanguage(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath
  if (base.toLowerCase() === "dockerfile") return "dockerfile"
  const dotIndex = base.lastIndexOf(".")
  if (dotIndex === -1) return "unknown"
  const ext = base.slice(dotIndex + 1).toLowerCase()
  return EXTENSION_LANGUAGE_MAP[ext] ?? "unknown"
}

export function isProseFile(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? filePath
  const dotIndex = base.lastIndexOf(".")
  if (dotIndex === -1) return false
  return PROSE_EXTENSIONS.has(base.slice(dotIndex + 1).toLowerCase())
}
