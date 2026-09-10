export type SupportedLanguage =
  | "java"
  | "kotlin"
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "c"
  | "cpp"
  | "csharp"
  | "swift"
  | "ruby"
  | "php"

export type DiagnosticCode =
  | "ERR_INLINE_FQN"
  | "ERR_UNRESOLVED_SYMBOL"
  | "ERR_ORPHAN_IMPORT"
  | "ERR_SYNTAX_ERROR"
  | "ERR_DEAD_CODE"
  | "ERR_NOOP_CODE"
  | "ERR_UNWIRED_CODE"
  | "ERR_ORPHAN_VARIABLE"
  | "ERR_EMPTY_CATCH"
  | "ERR_DEBUG_LEFTOVER"
  | "ERR_AI_SLOP_COMMENT"
  | "WARN_DEPRECATED_ALIAS"

export type DiagnosticSeverity = "error" | "warning"

export interface StaticDiagnostic {
  readonly code: DiagnosticCode
  readonly severity: DiagnosticSeverity
  readonly message: string
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly language: SupportedLanguage
  readonly symbol?: string
  readonly callerPerimeter?: readonly string[]
  readonly enclosingScope?: string
  readonly suggestedFix?: {
    readonly importToAdd?: string
    readonly importToRemove?: string
    readonly replacementText?: string
    readonly aliasRequired?: boolean
    readonly wireAction?: "wire_to_caller" | "delete"
    readonly callerContext?: string
  }
}

export interface LanguageStaticSpec {
  readonly language: SupportedLanguage
  readonly extensions: readonly string[]
  readonly supportsAliasedImports: boolean
  readonly allowFqnOnAmbiguity: boolean
  readonly disallowInlineFqn: boolean
  readonly universalImports: readonly string[]
  readonly standardPackages: readonly string[]
}

export const LANGUAGE_SPECS: Record<SupportedLanguage, LanguageStaticSpec> = {
  java: {
    language: "java",
    extensions: [".java"],
    supportsAliasedImports: false,
    allowFqnOnAmbiguity: true,
    disallowInlineFqn: true,
    universalImports: [
      "String",
      "Integer",
      "Long",
      "Boolean",
      "Double",
      "Float",
      "Byte",
      "Short",
      "Character",
      "Object",
      "Class",
      "System",
      "Thread",
      "Runnable",
      "Throwable",
      "Exception",
      "RuntimeException",
      "Error",
      "NullPointerException",
      "IllegalArgumentException",
      "IllegalStateException",
      "IndexOutOfBoundsException",
      "StringBuilder",
      "StringBuffer",
      "Math",
      "Comparable",
      "Iterable",
      "AutoCloseable",
      "Override",
      "Deprecated",
      "SuppressWarnings",
      "FunctionalInterface",
      "SafeVarargs",
    ],
    standardPackages: [
      "java.util",
      "java.io",
      "java.nio",
      "java.net",
      "java.time",
      "java.concurrent",
      "java.lang",
      "android.util",
      "android.os",
      "android.content",
      "android.app",
      "android.view",
      "org.springframework",
      "com.google",
    ],
  },
  kotlin: {
    language: "kotlin",
    extensions: [".kt", ".kts"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: true,
    universalImports: [
      "String",
      "Int",
      "Long",
      "Boolean",
      "Double",
      "Float",
      "Byte",
      "Short",
      "Char",
      "Any",
      "Unit",
      "Nothing",
      "List",
      "Set",
      "Map",
      "MutableList",
      "MutableSet",
      "MutableMap",
      "Array",
      "Sequence",
      "Pair",
      "Triple",
      "Throwable",
      "Exception",
      "RuntimeException",
      "IllegalArgumentException",
      "IllegalStateException",
      "println",
      "print",
      "require",
      "check",
      "error",
      "runCatching",
    ],
    standardPackages: [
      "kotlin",
      "kotlin.collections",
      "kotlin.text",
      "kotlin.io",
      "kotlinx.coroutines",
      "android.util",
      "android.os",
      "android.content",
      "org.springframework",
    ],
  },
  typescript: {
    language: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "string",
      "number",
      "boolean",
      "symbol",
      "bigint",
      "any",
      "unknown",
      "never",
      "void",
      "null",
      "undefined",
      "Array",
      "ReadonlyArray",
      "Record",
      "Partial",
      "Required",
      "Pick",
      "Omit",
      "Promise",
      "Error",
      "TypeError",
      "RangeError",
      "Map",
      "Set",
      "WeakMap",
      "WeakSet",
      "Date",
      "RegExp",
      "JSON",
      "Math",
      "console",
      "process",
      "Buffer",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
    standardPackages: [],
  },
  javascript: {
    language: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "Array",
      "Object",
      "Function",
      "String",
      "Number",
      "Boolean",
      "Promise",
      "Error",
      "TypeError",
      "Map",
      "Set",
      "Date",
      "JSON",
      "Math",
      "console",
      "process",
      "setTimeout",
      "clearTimeout",
    ],
    standardPackages: [],
  },
  python: {
    language: "python",
    extensions: [".py", ".pyi"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "str",
      "int",
      "float",
      "bool",
      "list",
      "dict",
      "set",
      "tuple",
      "bytes",
      "object",
      "type",
      "len",
      "range",
      "enumerate",
      "zip",
      "map",
      "filter",
      "print",
      "isinstance",
      "issubclass",
      "Exception",
      "ValueError",
      "TypeError",
      "KeyError",
      "IndexError",
      "RuntimeError",
      "None",
      "True",
      "False",
    ],
    standardPackages: [
      "os",
      "sys",
      "re",
      "math",
      "json",
      "typing",
      "collections",
      "dataclasses",
      "pathlib",
      "datetime",
      "itertools",
      "functools",
    ],
  },
  go: {
    language: "go",
    extensions: [".go"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "string",
      "int",
      "int8",
      "int16",
      "int32",
      "int64",
      "uint",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
      "float32",
      "float64",
      "bool",
      "byte",
      "rune",
      "error",
      "any",
      "make",
      "new",
      "len",
      "cap",
      "append",
      "copy",
      "close",
      "delete",
      "panic",
      "recover",
      "nil",
      "true",
      "false",
      "iota",
    ],
    standardPackages: [
      "fmt",
      "os",
      "io",
      "strings",
      "strconv",
      "bytes",
      "context",
      "sync",
      "time",
      "errors",
      "net/http",
      "encoding/json",
    ],
  },
  rust: {
    language: "rust",
    extensions: [".rs"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "i8",
      "i16",
      "i32",
      "i64",
      "i128",
      "isize",
      "u8",
      "u16",
      "u32",
      "u64",
      "u128",
      "usize",
      "f32",
      "f64",
      "bool",
      "char",
      "str",
      "String",
      "Option",
      "Some",
      "None",
      "Result",
      "Ok",
      "Err",
      "Vec",
      "Box",
      "Clone",
      "Copy",
      "Default",
      "Debug",
      "Display",
      "Iterator",
      "Into",
      "From",
      "AsRef",
    ],
    standardPackages: [
      "std",
      "core",
      "alloc",
    ],
  },
  c: {
    language: "c",
    extensions: [".c", ".h"],
    supportsAliasedImports: false,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "int",
      "char",
      "short",
      "long",
      "float",
      "double",
      "void",
      "size_t",
      "ssize_t",
      "uint8_t",
      "uint16_t",
      "uint32_t",
      "uint64_t",
      "int8_t",
      "int16_t",
      "int32_t",
      "int64_t",
      "bool",
      "true",
      "false",
      "NULL",
    ],
    standardPackages: [],
  },
  cpp: {
    language: "cpp",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "int",
      "char",
      "float",
      "double",
      "bool",
      "void",
      "auto",
      "size_t",
      "nullptr",
      "std",
    ],
    standardPackages: [],
  },
  csharp: {
    language: "csharp",
    extensions: [".cs"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: true,
    universalImports: [
      "string",
      "int",
      "long",
      "bool",
      "double",
      "float",
      "byte",
      "short",
      "char",
      "object",
      "void",
      "var",
      "dynamic",
      "Task",
      "Action",
      "Func",
      "Console",
      "Math",
      "Exception",
    ],
    standardPackages: [
      "System",
      "System.Collections.Generic",
      "System.Linq",
      "System.Threading.Tasks",
      "System.IO",
      "System.Text",
    ],
  },
  swift: {
    language: "swift",
    extensions: [".swift"],
    supportsAliasedImports: false,
    allowFqnOnAmbiguity: true,
    disallowInlineFqn: false,
    universalImports: [
      "String",
      "Int",
      "Double",
      "Float",
      "Bool",
      "Array",
      "Dictionary",
      "Set",
      "Optional",
      "print",
      "Void",
    ],
    standardPackages: ["Foundation", "SwiftUI", "Combine"],
  },
  ruby: {
    language: "ruby",
    extensions: [".rb"],
    supportsAliasedImports: false,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: false,
    universalImports: [
      "puts",
      "p",
      "print",
      "raise",
      "require",
      "attr_reader",
      "attr_writer",
      "attr_accessor",
    ],
    standardPackages: [],
  },
  php: {
    language: "php",
    extensions: [".php"],
    supportsAliasedImports: true,
    allowFqnOnAmbiguity: false,
    disallowInlineFqn: true,
    universalImports: [
      "echo",
      "print",
      "var_dump",
      "isset",
      "empty",
      "die",
      "exit",
      "array",
      "int",
      "string",
      "bool",
      "float",
    ],
    standardPackages: [],
  },
}

export function detectLanguage(filePath: string): SupportedLanguage | undefined {
  const lower = filePath.toLowerCase()
  for (const [lang, spec] of Object.entries(LANGUAGE_SPECS)) {
    if (spec.extensions.some((ext) => lower.endsWith(ext))) {
      return lang as SupportedLanguage
    }
  }
  return undefined
}

export interface ImportedSymbol {
  readonly name: string
  readonly alias?: string
  readonly fullPath: string
  readonly isWildcard: boolean
  readonly isStatic: boolean
  readonly line: number
}

export interface DeclaredSymbol {
  readonly name: string
  readonly kind: "class" | "interface" | "enum" | "record" | "function" | "field" | "variable" | "package"
  readonly line: number
  readonly scopeDepth: number
}

export interface SymbolUsage {
  readonly name: string
  readonly line: number
  readonly column: number
  readonly isQualified: boolean
  readonly qualifier?: string
}

export interface StaticAuditResult {
  readonly passed: boolean
  readonly language: SupportedLanguage
  readonly filePath: string
  readonly diagnostics: readonly StaticDiagnostic[]
}
