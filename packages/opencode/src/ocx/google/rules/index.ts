import type { GoogleRule, SupportedLanguage } from "../types"
import { TYPESCRIPT_STYLE_RULES } from "./style-typescript"
import { JAVASCRIPT_STYLE_RULES } from "./style-javascript"
import { PYTHON_STYLE_RULES } from "./style-python"
import { JAVA_STYLE_RULES } from "./style-java"
import { CPP_STYLE_RULES } from "./style-cpp"
import { GO_STYLE_RULES } from "./style-go"
import { SHELL_STYLE_RULES } from "./style-shell"
import { HTML_CSS_STYLE_RULES } from "./style-html-css"
import { JSON_STYLE_RULES } from "./style-json"
import { DOCGUIDE_STYLE_RULES } from "./style-docguide"
import { ENGINEERING_PRACTICES_RULES } from "./eng-practices"
import { TESTING_DOCTRINE_RULES } from "./testing-doctrine"
import { API_DESIGN_RULES } from "./api-design"
import { ARCHITECTURE_RULES } from "./architecture"
import { SECURITY_RULES } from "./security"

export const ALL_GOOGLE_RULES: readonly GoogleRule[] = [
  ...TYPESCRIPT_STYLE_RULES,
  ...JAVASCRIPT_STYLE_RULES,
  ...PYTHON_STYLE_RULES,
  ...JAVA_STYLE_RULES,
  ...CPP_STYLE_RULES,
  ...GO_STYLE_RULES,
  ...SHELL_STYLE_RULES,
  ...HTML_CSS_STYLE_RULES,
  ...JSON_STYLE_RULES,
  ...DOCGUIDE_STYLE_RULES,
  ...ENGINEERING_PRACTICES_RULES,
  ...TESTING_DOCTRINE_RULES,
  ...API_DESIGN_RULES,
  ...ARCHITECTURE_RULES,
  ...SECURITY_RULES,
]

export function detectLanguage(filePath: string): SupportedLanguage {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return "typescript"
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "javascript"
  }
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) {
    return "python"
  }
  if (lower.endsWith(".java")) {
    return "java"
  }
  if (
    lower.endsWith(".cpp") ||
    lower.endsWith(".cc") ||
    lower.endsWith(".cxx") ||
    lower.endsWith(".hpp") ||
    lower.endsWith(".h")
  ) {
    return "cpp"
  }
  if (lower.endsWith(".go")) {
    return "go"
  }
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) {
    return "shell"
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "html"
  }
  if (lower.endsWith(".css") || lower.endsWith(".scss")) {
    return "css"
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
    return "json"
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown"
  }
  return "all"
}

export function getRulesForLanguage(language: SupportedLanguage): readonly GoogleRule[] {
  return ALL_GOOGLE_RULES.filter(
    (rule) => rule.languages.includes(language) || rule.languages.includes("all")
  )
}

export function getRuleById(id: string): GoogleRule | undefined {
  return ALL_GOOGLE_RULES.find((rule) => rule.id === id)
}
