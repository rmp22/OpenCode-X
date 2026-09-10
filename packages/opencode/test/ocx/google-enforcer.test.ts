import { describe, expect, test } from "bun:test"
import {
  GOOGLE_PRACTICE_CATALOG,
  GoogleRules,
  checkGooglePractices,
  fixContent,
  formatJson,
  formatMarkdown,
  formatTerminal,
  hasBlockingViolations,
  scanDiff,
  scanText,
} from "../../src/ocx/google"
import { runCli } from "../../src/ocx/google/cli"
import { PracticePacks } from "../../src/ocx/practice-packs"

describe("Google Developer Practices Catalog", () => {
  test("catalog contains all core Google practice categories", () => {
    expect(GOOGLE_PRACTICE_CATALOG.length).toBeGreaterThanOrEqual(10)
    const categories = new Set(GOOGLE_PRACTICE_CATALOG.map((c) => c.category))
    expect(categories.has("style")).toBe(true)
    expect(categories.has("eng-practices")).toBe(true)
    expect(categories.has("testing")).toBe(true)
    expect(categories.has("api-design")).toBe(true)
    expect(categories.has("architecture")).toBe(true)
    expect(categories.has("security")).toBe(true)
    expect(categories.has("documentation")).toBe(true)
  })

  test("each catalog entry has valid citations and principles", () => {
    for (const entry of GOOGLE_PRACTICE_CATALOG) {
      expect(entry.id.length).toBeGreaterThan(0)
      expect(entry.source.length).toBeGreaterThan(0)
      expect(entry.detailedPrinciples.length).toBeGreaterThan(0)
      expect(entry.antiPatterns.length).toBeGreaterThan(0)
      expect(entry.recommendedPatterns.length).toBeGreaterThan(0)
    }
  })
})

describe("Google Style Guide Rules", () => {
  describe("TypeScript Style", () => {
    test("detects tab indentation", () => {
      const code = "\tconst x = 1;"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-indent")).toBe(true)
    })

    test("detects odd space indentation", () => {
      const code = "   const x = 1;"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-indent")).toBe(true)
    })

    test("passes valid 2-space indentation", () => {
      const code = "  const x = 1;"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-indent")).toBe(false)
    })

    test("detects missing semicolons", () => {
      const code = "const x = 1"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-semicolon")).toBe(true)
    })

    test("detects explicit any type", () => {
      const code = "const data: any = JSON.parse(str);"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-no-any")).toBe(true)
    })

    test("detects non-null assertion operator", () => {
      const code = "const name = user!.profile.name;"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-no-non-null-assertion")).toBe(true)
    })

    test("detects var declaration", () => {
      const code = "var count = 0;"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-no-var")).toBe(true)
    })

    test("detects TODO without owner", () => {
      const code = "// TODO: fix this later"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-todo-owner")).toBe(true)
    })

    test("passes TODO with owner", () => {
      const code = "// TODO(alice): fix this later"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-todo-owner")).toBe(false)
    })

    test("detects debugger statements", () => {
      const code = "debugger;"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-no-debugger")).toBe(true)
    })

    test("detects default exports", () => {
      const code = "export default function doSomething() {}"
      const result = scanText("file.ts", code)
      expect(result.findings.some((f) => f.ruleId === "google-ts-named-exports")).toBe(true)
    })
  })

  describe("JavaScript Style", () => {
    test("detects loose equality", () => {
      const code = "if (a == b) {}"
      const result = scanText("file.js", code)
      expect(result.findings.some((f) => f.ruleId === "google-js-strict-equality")).toBe(true)
    })

    test("detects throwing string literals", () => {
      const code = 'throw "failed";'
      const result = scanText("file.js", code)
      expect(result.findings.some((f) => f.ruleId === "google-js-throw-error")).toBe(true)
    })

    test("detects eval usage", () => {
      const code = 'eval("2 + 2");'
      const result = scanText("file.js", code)
      expect(result.findings.some((f) => f.ruleId === "google-js-no-eval")).toBe(true)
    })
  })

  describe("Python Style", () => {
    test("detects tab and odd indentations", () => {
      const code = "\tdef foo():\n\t  pass"
      const result = scanText("script.py", code)
      expect(result.findings.some((f) => f.ruleId === "google-py-indent")).toBe(true)
    })

    test("detects lines exceeding 80 characters", () => {
      const code = "# " + "a".repeat(85)
      const result = scanText("script.py", code)
      expect(result.findings.some((f) => f.ruleId === "google-py-line-length")).toBe(true)
    })

    test("detects wildcard imports", () => {
      const code = "from math import *"
      const result = scanText("script.py", code)
      expect(result.findings.some((f) => f.ruleId === "google-py-no-wildcard-import")).toBe(true)
    })

    test("detects mutable default arguments", () => {
      const code = "def append_item(val, items=[]):\n  pass"
      const result = scanText("script.py", code)
      expect(result.findings.some((f) => f.ruleId === "google-py-no-mutable-defaults")).toBe(true)
    })

    test("detects bare except", () => {
      const code = "try:\n  run()\nexcept:\n  pass"
      const result = scanText("script.py", code)
      expect(result.findings.some((f) => f.ruleId === "google-py-no-bare-except")).toBe(true)
    })
  })

  describe("Java Style", () => {
    test("detects wildcard imports in Java", () => {
      const code = "import java.util.*;"
      const result = scanText("App.java", code)
      expect(result.findings.some((f) => f.ruleId === "google-java-no-wildcard-import")).toBe(true)
    })

    test("detects lines exceeding 100 characters in Java", () => {
      const code = "String message = \"" + "x".repeat(110) + "\";"
      const result = scanText("App.java", code)
      expect(result.findings.some((f) => f.ruleId === "google-java-line-length")).toBe(true)
    })

    test("detects empty catch block without expected comment", () => {
      const code = "try { parse(); } catch (Exception e) {}"
      const result = scanText("App.java", code)
      expect(result.findings.some((f) => f.ruleId === "google-java-empty-catch")).toBe(true)
    })
  })

  describe("C++ Style", () => {
    test("detects using namespace std", () => {
      const code = "using namespace std;"
      const result = scanText("main.cpp", code)
      expect(result.findings.some((f) => f.ruleId === "google-cpp-no-using-namespace-std")).toBe(true)
    })

    test("detects NULL usage instead of nullptr", () => {
      const code = "int* ptr = NULL;"
      const result = scanText("main.cpp", code)
      expect(result.findings.some((f) => f.ruleId === "google-cpp-nullptr")).toBe(true)
    })
  })

  describe("Go Style", () => {
    test("detects context not as first parameter", () => {
      const code = "func DoWork(name string, ctx context.Context) error {\n  return nil\n}"
      const result = scanText("server.go", code)
      expect(result.findings.some((f) => f.ruleId === "google-go-context-first")).toBe(true)
    })

    test("detects unidiomatic receiver name this or self", () => {
      const code = "func (this *Server) Start() {}"
      const result = scanText("server.go", code)
      expect(result.findings.some((f) => f.ruleId === "google-go-receiver-name")).toBe(true)
    })

    test("detects panic in library code", () => {
      const code = 'func ReadData() {\n  panic("failed")\n}'
      const result = scanText("reader.go", code)
      expect(result.findings.some((f) => f.ruleId === "google-go-no-panic")).toBe(true)
    })
  })

  describe("Shell Style", () => {
    test("detects non-bash shebang", () => {
      const code = "#!/bin/sh\necho hello"
      const result = scanText("build.sh", code)
      expect(result.findings.some((f) => f.ruleId === "google-shell-bash")).toBe(true)
    })

    test("detects missing strict error handling in scripts with 5+ lines", () => {
      const code = "#!/bin/bash\necho a\necho b\necho c\necho d\necho e"
      const result = scanText("run.sh", code)
      expect(result.findings.some((f) => f.ruleId === "google-shell-strict")).toBe(true)
    })

    test("detects unquoted variables", () => {
      const code = '#!/bin/bash\necho $MY_VAR'
      const result = scanText("deploy.sh", code)
      expect(result.findings.some((f) => f.ruleId === "google-shell-unquoted-vars")).toBe(true)
    })
  })

  describe("HTML and CSS Style", () => {
    test("detects missing doctype", () => {
      const code = "<html><body></body></html>"
      const result = scanText("index.html", code)
      expect(result.findings.some((f) => f.ruleId === "google-html-doctype")).toBe(true)
    })

    test("detects inline styles", () => {
      const code = '<!DOCTYPE html><html><body><div style="color:red"></div></body></html>'
      const result = scanText("index.html", code)
      expect(result.findings.some((f) => f.ruleId === "google-html-no-inline-styles")).toBe(true)
    })

    test("detects ID selectors in CSS", () => {
      const code = "#header { color: red; }"
      const result = scanText("style.css", code)
      expect(result.findings.some((f) => f.ruleId === "google-css-no-id-selector")).toBe(true)
    })
  })

  describe("JSON Style", () => {
    test("detects invalid JSON syntax", () => {
      const code = "{ invalid json }"
      const result = scanText("config.json", code)
      expect(result.findings.some((f) => f.ruleId === "google-json-syntax")).toBe(true)
    })

    test("detects tab indentation in JSON", () => {
      const code = '{\n\t"name": "test"\n}'
      const result = scanText("config.json", code)
      expect(result.findings.some((f) => f.ruleId === "google-json-indent")).toBe(true)
    })
  })

  describe("Documentation Style Guide", () => {
    test("detects generic link text like click here", () => {
      const code = "Please [click here](https://example.com) to view docs."
      const result = scanText("README.md", code)
      expect(result.findings.some((f) => f.ruleId === "google-doc-no-click-here")).toBe(true)
    })

    test("detects code blocks without language tags", () => {
      const code = "```\nconst x = 1\n```"
      const result = scanText("guide.md", code)
      expect(result.findings.some((f) => f.ruleId === "google-doc-code-language")).toBe(true)
    })

    test("detects skipped heading levels", () => {
      const code = "# Title\n\n### Skipped Section"
      const result = scanText("guide.md", code)
      expect(result.findings.some((f) => f.ruleId === "google-doc-heading-levels")).toBe(true)
    })
  })
})

describe("Google Engineering Practices Rules", () => {
  test("flags commit message title exceeding 72 characters", () => {
    const message = "a".repeat(80) + "\n\nDetailed explanation."
    const result = scanText("file.ts", "const x = 1;", {
      categories: ["eng-practices"],
    })
    const findings = GoogleRules.ALL_GOOGLE_RULES.find((r) => r.id === "google-eng-cl-description")?.check({
      filePath: "file.ts",
      content: "const x = 1;",
      lines: ["const x = 1;"],
      language: "typescript",
      gitCommitMessage: message,
    })
    expect(findings?.some((f) => f.ruleId === "google-eng-cl-description")).toBe(true)
  })

  test("flags changes exceeding 500 lines", () => {
    const findings = GoogleRules.ALL_GOOGLE_RULES.find((r) => r.id === "google-eng-cl-size")?.check({
      filePath: "file.ts",
      content: "",
      lines: [],
      language: "typescript",
      changedLinesCount: 650,
    })
    expect(findings?.some((f) => f.ruleId === "google-eng-cl-size")).toBe(true)
  })

  test("detects commented-out code blocks", () => {
    const code = "// const oldData = fetchOldData();"
    const result = scanText("file.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-eng-commented-code")).toBe(true)
  })
})

describe("Google Testing Doctrine Rules", () => {
  test("detects loops and conditionals in test files", () => {
    const code = "describe('math', () => {\n  test('adds', () => {\n    if (1 === 1) {\n      expect(2).toBe(2);\n    }\n  });\n});"
    const result = scanText("math.test.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-test-no-logic")).toBe(true)
  })

  test("detects sleep/setTimeout in test files", () => {
    const code = "describe('timer', () => {\n  test('waits', async () => {\n    await new Promise(r => setTimeout(r, 100));\n  });\n});"
    const result = scanText("timer.test.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-test-no-sleep")).toBe(true)
  })

  test("detects uninformative test names", () => {
    const code = 'describe("api", () => {\n  test("test1", () => {\n    expect(true).toBe(true);\n  });\n});'
    const result = scanText("api.test.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-test-behavior-naming")).toBe(true)
  })
})

describe("Google API Design Rules", () => {
  test("detects RPC verb in URL endpoints", () => {
    const code = 'const url = "/api/users/getUser";'
    const result = scanText("api.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-api-resource-verbs")).toBe(true)
  })
})

describe("Software Engineering at Google Architecture & Security Rules", () => {
  test("detects deprecation annotations without migration guidance", () => {
    const code = "/** @deprecated */\nexport function oldMethod() {}"
    const result = scanText("service.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-arch-deprecation-instructions")).toBe(true)
  })

  test("detects SQL string interpolation", () => {
    const code = "const query = `SELECT * FROM users WHERE id = ${userId}`;"
    const result = scanText("db.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-sec-sql-injection")).toBe(true)
  })

  test("detects innerHTML assignment", () => {
    const code = "element.innerHTML = userProvidedString;"
    const result = scanText("dom.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-sec-xss")).toBe(true)
  })

  test("detects hardcoded API key patterns", () => {
    const code = 'const apiKey = "AIzaSy' + 'A'.repeat(33) + '";'
    const result = scanText("auth.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-sec-hardcoded-secrets")).toBe(true)
  })

  test("detects unsafe logging of credentials", () => {
    const code = 'console.log("User auth:", password);'
    const result = scanText("auth.ts", code)
    expect(result.findings.some((f) => f.ruleId === "google-sec-unsafe-logging")).toBe(true)
  })
})

describe("Google Practice Fixer", () => {
  test("fixes tabs to 2 spaces", () => {
    const code = "\tconst x = 1;"
    const fixed = fixContent("test.ts", code)
    expect(fixed.modified).toBe(true)
    expect(fixed.fixedContent).toBe("  const x = 1;")
  })

  test("fixes var to const", () => {
    const code = "var answer = 42;"
    const fixed = fixContent("test.ts", code)
    expect(fixed.modified).toBe(true)
    expect(fixed.fixedContent).toBe("const answer = 42;")
  })

  test("fixes TODO formatting to include owner", () => {
    const code = "// TODO: investigate memory leak"
    const fixed = fixContent("test.ts", code, "alice")
    expect(fixed.modified).toBe(true)
    expect(fixed.fixedContent).toBe("// TODO(alice): investigate memory leak")
  })

  test("adds missing semicolons to statements", () => {
    const code = "const count = 10"
    const fixed = fixContent("test.ts", code)
    expect(fixed.modified).toBe(true)
    expect(fixed.fixedContent).toBe("const count = 10;")
  })

  test("replaces NULL with nullptr in C++", () => {
    const code = "if (ptr == NULL)"
    const fixed = fixContent("test.cpp", code)
    expect(fixed.modified).toBe(true)
    expect(fixed.fixedContent).toBe("if (ptr == nullptr)")
  })
})

describe("Reporters and Gate Adapter", () => {
  test("formats terminal ANSI report", () => {
    const result = scanText("file.ts", "var x = 1;")
    const terminalOut = formatTerminal(result, false)
    expect(terminalOut).toContain("Google Developer Practices Scan")
    expect(terminalOut).toContain("file.ts")
  })

  test("formats JSON report", () => {
    const result = scanText("file.ts", "var x = 1;")
    const jsonOut = formatJson(result)
    const parsed = JSON.parse(jsonOut)
    expect(parsed.errorCount).toBeGreaterThanOrEqual(1)
  })

  test("formats Markdown report", () => {
    const result = scanText("file.ts", "var x = 1;")
    const mdOut = formatMarkdown(result)
    expect(mdOut).toContain("# Google Developer Practices Scan Report")
  })

  test("gate adapter detects blocking violations", () => {
    expect(hasBlockingViolations("file.ts", "var x = 1;")).toBe(true)
    expect(hasBlockingViolations("file.ts", "const x = 1;")).toBe(false)
  })

  test("checkGooglePractices returns structured findings", () => {
    const findings = checkGooglePractices("file.ts", "var x = 1;")
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0].category).toBe("style")
  })

  test("scanDiff parses unified git diff", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
+var x = 1;
`
    const result = scanDiff(diff)
    expect(result.findings.some((f) => f.ruleId === "google-ts-no-var")).toBe(true)
  })
})

describe("Practice Packs Integration", () => {
  test("PracticePacks includes Google practice packs", async () => {
    const packs = await PracticePacks.list()
    const packNames = packs.map((p) => p.name)
    expect(packNames).toContain("google-style")
    expect(packNames).toContain("google-eng-practices")
    expect(packNames).toContain("google-testing")
    expect(packNames).toContain("google-api-design")
    expect(packNames).toContain("google-security")
  })
})
