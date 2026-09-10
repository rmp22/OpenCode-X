import { describe, expect, test } from "bun:test"
import { CodeGate } from "../../src/ocx/code-gate"

describe("code gate python tells", () => {
  test("flags bare except, mutable defaults, debug prints, and eval", () => {
    const lines = [
      "try:",
      "    risky()",
      "except:",
      "    pass",
      "",
      "def add_item(item, bucket=[]):",
      "    bucket.append(item)",
      "    return bucket",
      "",
      "print('here')",
      "value = eval(user_input)",
    ]
    const ids = CodeGate.lineFindings("app/services.py", lines).map((finding) => finding.id)
    expect(ids).toContain("F2-bare-except")
    expect(ids).toContain("F3-mutable-default")
    expect(ids).toContain("F4-debug-print")
    expect(ids).toContain("F5-eval-exec")
  })

  test("passes correct python: typed except, none default, logger, ast parse", () => {
    const lines = [
      "except (ValueError, KeyError) as error:",
      "def add_item(item, bucket=None):",
      "    bucket = bucket if bucket is not None else []",
      'logger.debug("step done")',
      "value = ast.literal_eval(serialized)",
    ]
    expect(CodeGate.lineFindings("app/services.py", lines)).toEqual([])
  })

  test("skips debug prints in test files", () => {
    const lines = ["print(rendered_case)"]
    expect(CodeGate.lineFindings("tests/test_render.py", lines)).toEqual([])
  })

  test("ignores non-python and non-js files", () => {
    expect(CodeGate.lineFindings("main.go", ["except:", "fmt.Println(err)"])).toEqual([])
  })
})

describe("code gate jvm fqn tells", () => {
  test("flags inline FQN calls in kotlin and java with per-language advice", () => {
    const kt = CodeGate.lineFindings("app/Foo.kt", ["val gson = com.google.gson.Gson()"])
    expect(kt.map((finding) => finding.id)).toContain("F14-fqn-inline")
    expect(kt[0].message).toContain("alias with `as`")
    const java = CodeGate.lineFindings("src/Util.java", ["return com.foo.Util.helper();"])
    expect(java.map((finding) => finding.id)).toContain("F14-fqn-inline")
    expect(java[0].message).toContain("Java has no import alias")
  })

  test("excludes java static imports and semicolon-terminated declarations", () => {
    const lines = [
      "package com.example.app;",
      "import com.android.foo.Foo;",
      "import static com.android.foo.Foo.doIt;",
      "import com.android.foo.Bar as BarAlias",
      "val x = Foo.parse(input)",
      "val y = BarAlias.load()",
      'val tag = "com.example.Message"',
      "foo.bar()",
    ]
    expect(CodeGate.lineFindings("app/Main.kt", lines).some((finding) => finding.id === "F14-fqn-inline")).toBe(false)
    expect(CodeGate.lineFindings("app/Main.java", ["import com.android.foo.Foo;"]).some((f) => f.id === "F14-fqn-inline")).toBe(false)
  })

  test("ignores JVM qualified names inside comments, strings, and short calls", () => {
    const lines = [
      "// return com.foo.Util.helper();",
      'val tag = "com.google.Message"',
      "foo.bar()",
      "return com.foo.Util.helper();",
    ]
    const findings = CodeGate.lineFindings("app/Main.kt", lines)
    expect(findings.filter((finding) => finding.id === "F14-fqn-inline")).toHaveLength(1)
  })

  test("flags obvious placeholder declarations across language families", () => {
    const cases = [
      ["src/request.ts", "function doThing() { return request }"],
      ["src/request.py", "def doThing():\n    return request"],
      ["src/request.rs", "fn doThing() {}"],
      ["src/request.go", "func doThing() {}"],
      ["src/Request.swift", "func doThing() {}"],
      ["src/Request.java", "class Foo {}"],
    ] as const
    for (const [path, source] of cases)
      expect(CodeGate.lineFindings(path, source.split("\n")).map((finding) => finding.id)).toContain("F15-placeholder-name")
  })

  test("keeps descriptive declarations and test placeholders clear", () => {
    expect(CodeGate.lineFindings("src/request.ts", ["function buildRequest() { return request }"])).toEqual([])
    expect(CodeGate.lineFindings("tests/request.ts", ["function doThing() { return value }"])).toEqual([])
  })
})

describe("code gate boilerplate tells", () => {
  const pasted = [
    "const payload = buildPayload(order);",
    "const response = await client.post('/orders', payload);",
    "if (!response.ok) throw new OrderError(response.status);",
  ]

  test("flags a three-line block pasted twice in one file", () => {
    const lines = [...pasted, "", "// shipping path", ...pasted]
    const findings = CodeGate.lineFindings("src/orders.ts", lines)
    expect(findings.map((finding) => finding.id)).toContain("F12-duplicate-block")
  })

  test("passes near-duplicates that differ per line", () => {
    const lines = [
      "const userPayload = buildPayload(user);",
      "const userResponse = await client.post('/users', userPayload);",
      "if (!userResponse.ok) throw new UserError(userResponse.status);",
      "const orderPayload = buildPayload(order);",
      "const orderResponse = await client.post('/orders', orderPayload);",
      "if (!orderResponse.ok) throw new OrderError(orderResponse.status);",
    ]
    expect(CodeGate.lineFindings("src/accounts.ts", lines).some((finding) => finding.id === "F12-duplicate-block")).toBe(false)
  })

  test("does not fire on accessor pairs or short repeated lines", () => {
    const lines = ["get name() { return this._name; }", "get age() { return this._age; }"]
    expect(CodeGate.lineFindings("src/person.ts", lines).some((finding) => finding.id === "F12-duplicate-block")).toBe(false)
  })

  test("flags empty function scaffolds and kotlin overrides", () => {
    const js = CodeGate.lineFindings("src/hook.js", ["function onReady(event) {}"])
    expect(js.map((finding) => finding.id)).toContain("F13-empty-scaffold")
    const kt = CodeGate.lineFindings("app/Widget.kt", ["override fun onBind(intent: Intent): IBinder? { }"])
    expect(kt.map((finding) => finding.id)).toContain("F13-empty-scaffold")
  })

  test("flags python def-with-pass stubs once per file", () => {
    const lines = [
      "class Service:",
      "    def start(self, config):",
      "        pass",
      "    def stop(self):",
      "        pass",
    ]
    const findings = CodeGate.lineFindings("svc/service.py", lines)
    expect(findings.filter((finding) => finding.id === "F13-empty-scaffold")).toHaveLength(1)
  })

  test("passes arrow-callback empties and implemented functions", () => {
    const lines = [
      "button.onClick(() => {})",
      "function real(x: number) { return x + 1; }",
    ]
    expect(CodeGate.lineFindings("src/ui.tsx", lines).some((finding) => finding.id === "F13-empty-scaffold")).toBe(false)
  })
})

describe("code gate js-ts tells", () => {
  test("flags eval, new Function, innerHTML writes, and document.write once per rule", () => {
    const lines = [
      "const result = eval(input);",
      "const fn = new Function(body);",
      "node.innerHTML = userHtml;",
      "document.write(page);",
    ]
    const ids = CodeGate.lineFindings("src/widget.ts", lines).map((finding) => finding.id)
    expect(ids).toContain("F5-eval-exec")
    expect(ids).toContain("F6-innerhtml-write")
    expect(new Set(ids).size).toBe(2)
  })

  test("passes textContent assignment and plain function calls", () => {
    const lines = ["label.textContent = value;", "const fn = makeHandler(body);"]
    expect(CodeGate.lineFindings("src/widget.ts", lines)).toEqual([])
  })

  test("caps findings per file by distinct rule, not occurrence count", () => {
    const lines = Array.from({ length: 8 }, (_, i) => `eval(${i})`)
    expect(CodeGate.lineFindings("src/x.js", lines)).toHaveLength(1)
  })
})

describe("code gate markup baseline", () => {
  test("flags missing alt, blank tabs without noopener, click divs, missing lang and viewport", () => {
    const html = [
      '<html>',
      '<img src="/assets/hero.jpg">',
      '<a href="https://x.com" target="_blank">X</a>',
      "<div onclick=\"open()\">Open</div>",
      "</html>",
    ].join("\n")
    const ids = CodeGate.webFindings(html).map((finding) => finding.id)
    expect(ids).toContain("F7-img-missing-alt")
    expect(ids).toContain("F8-blank-no-opener")
    expect(ids).toContain("F9-div-onclick")
    expect(ids).toContain("F10-html-no-lang")
    expect(ids).toContain("F11-no-viewport")
  })

  test("passes accessible markup with lang, viewport, alt, labels, and buttons", () => {
    const html = [
      '<html lang="en">',
      '<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
      '<img src="/assets/hero.jpg" alt="Team reviewing the roadmap">',
      '<a href="https://x.com" target="_blank" rel="noopener noreferrer">X</a>',
      "<button type=\"button\" onclick=\"open()\">Open</button>",
      "</html>",
    ].join("\n")
    expect(CodeGate.webFindings(html)).toEqual([])
  })

  test("accepts decorative empty alt and role-button divs", () => {
    const html = [
      '<html lang="en"><meta name="viewport" content="width=device-width"></html>'.replace("</html>", ""),
      '<img src="/divider.svg" alt="">',
      '<div onclick="toggle()" role="button" tabindex="0">Menu</div>',
    ].join("\n")
    expect(CodeGate.webFindings(html)).toEqual([])
  })
})
