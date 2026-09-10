import { describe, expect, test } from "bun:test"
import { SanityChecker } from "../../src/ocx/sanity"

describe("SanityChecker Runtime Interception (Comments & FQN)", () => {
  test("flags explanatory comments in TypeScript", () => {
    const codeWithComment = `
export function add(a: number, b: number): number {
  // explain code: add two numbers together
  return a + b;
}
`
    const report = SanityChecker.checkSanity("src/math.ts", codeWithComment)
    expect(report.passed).toBe(false)
    expect(report.notice).toContain("Detected explanatory code comments")
  })

  test("flags inline FQNs in Java edits and provides actionable import guidance", () => {
    const javaCodeWithFqn = `
package com.android.server.am;

public class ActivityManagerService {
    public void start() {
        android.util.Log.d("TAG", "starting");
    }
}
`
    const report = SanityChecker.checkSanity("ActivityManagerService.java", javaCodeWithFqn)
    expect(report.passed).toBe(false)
    expect(report.notice).toContain("Detected inline fully qualified name(s) (FQNs)")
    expect(report.notice).toContain("Line 6: Inline FQN 'android.util.Log' is forbidden in Java")
    expect(report.notice).toContain("Add 'import android.util.Log;' at the top of the file and use simple name 'Log'")
  })

  test("flags inline FQNs in Kotlin edits and requires aliasing", () => {
    const kotlinCodeWithFqn = `
package com.example.controller

class OrderController {
    fun getStatus(): Any {
        return org.springframework.http.ResponseEntity.ok("active")
    }
}
`
    const report = SanityChecker.checkSanity("OrderController.kt", kotlinCodeWithFqn)
    expect(report.passed).toBe(false)
    expect(report.notice).toContain("Detected inline fully qualified name(s) (FQNs)")
    expect(report.notice).toContain("org.springframework.http.ResponseEntity")
  })

  test("passes clean Java code with proper imports", () => {
    const cleanJavaCode = `
package com.android.server.am;

import android.util.Log;

public class ActivityManagerService {
    public void start() {
        Log.d("TAG", "starting");
    }
}
`
    const report = SanityChecker.checkSanity("ActivityManagerService.java", cleanJavaCode)
    expect(report.passed).toBe(true)
    expect(report.notice).toBeUndefined()
  })

  test("flags unresolved symbols and missing imports in Java to break tunnel vision", () => {
    const javaCodeWithMissingImport = `
package com.example.service;

import java.util.List;

public class DataService {
    public void process() {
        CompletableFuture.supplyAsync(() -> "done");
    }
}
`
    const report = SanityChecker.checkSanity("DataService.java", javaCodeWithMissingImport)
    expect(report.passed).toBe(false)
    expect(report.notice).toContain("Detected unresolved symbol(s) / missing import(s)")
    expect(report.notice).toContain("CompletableFuture")
  })

  test("ignores pre-existing whole-file violations outside the edited lines", () => {
    const previous = `package com.example.service;

import java.util.List;
import java.util.ArrayList;

public class TaskProcessor {
    public void run(List<String> items) {
        System.out.println(items.size());
    }
}
`
    const current = previous.replace(
      "        System.out.println(items.size());",
      "        int size = items.size();\n        System.out.println(size);",
    )
    const report = SanityChecker.checkSanity("TaskProcessor.java", current, {
      previousContent: previous,
    })
    expect(report.passed).toBe(true)
  })

  test("still flags violations introduced on the edited lines", () => {
    const previous = `package com.example.service;

public class TaskProcessor {
    public void run() {
        System.out.println("ok");
    }
}
`
    const current = previous.replace(
      '        System.out.println("ok");',
      '        android.util.Log.d("TAG", "ok");',
    )
    const report = SanityChecker.checkSanity("TaskProcessor.java", current, {
      previousContent: previous,
    })
    expect(report.passed).toBe(false)
    expect(report.notice).toContain("android.util.Log")
  })

  test("does not flag constant field references as unresolved symbols", () => {
    const javaCode = `
package com.example.service;

public class KeyguardMediator {
    private static final String TAG = "Keyguard";
    private static final boolean DEBUG = false;
    private static final int TIMEOUT_MS = 100;

    public void exit() {
        if (DEBUG) {
            System.out.println(TAG + TIMEOUT_MS);
        }
    }
}
`
    const report = SanityChecker.checkSanity("KeyguardMediator.java", javaCode)
    expect(report.notice ?? "").not.toContain("Unresolved symbol 'TAG'")
    expect(report.notice ?? "").not.toContain("Unresolved symbol 'DEBUG'")
    expect(report.notice ?? "").not.toContain("Unresolved symbol 'TIMEOUT_MS'")
  })

  test("allows inline FQN in Java when the simple name is imported from another package", () => {
    const javaCode = `
package com.example.service;

import com.example.other.R;

public class ViewBinder {
    public void bind() {
        int id = com.android.internal.R.id.content;
    }
}
`
    const report = SanityChecker.checkSanity("ViewBinder.java", javaCode)
    expect(report.notice ?? "").not.toContain("com.android.internal.R")
  })

  test("flags dead code following return statements", () => {
    const code = `
function calculateTotal(price: number): number {
  return price * 1.2;
  const unusedExtra = 10;
}
`
    const report = SanityChecker.checkSanity("calc.ts", code)
    expect(report.notice).toContain("Dead/unreachable code detected")
    expect(report.passed).toBe(false)
  })

  test("flags no-op self-assignments", () => {
    const code = `
class Order {
  setAmount(amount: number) {
    amount = amount;
  }
}
`
    const report = SanityChecker.checkSanity("order.ts", code)
    expect(report.notice).toContain("No-op self-assignment detected")
    expect(report.passed).toBe(false)
  })

  test("flags empty catch blocks", () => {
    const code = `
function runSafe() {
  try {
    doWork();
  } catch (e) {}
}
`
    const report = SanityChecker.checkSanity("runner.ts", code)
    expect(report.notice).toContain("Empty catch/except block")
    expect(report.passed).toBe(false)
  })

  test("flags unwired functions and reports anti-tunnel caller perimeter", () => {
    const code = `
function mainDispatcher() {
  return 42;
}

function orphanedHelper() {
  return 100;
}
`
    const report = SanityChecker.checkSanity("dispatcher.ts", code)
    expect(report.notice).toContain("Unwired or orphan code detected")
    expect(report.notice).toContain("orphanedHelper")
    expect(report.notice).toContain("Perimeter Callers: mainDispatcher")
    expect(report.passed).toBe(false)
  })

  test("flags inline FQN in C# and suggests aliased using on collision", () => {
    const csharpCode = `
using System;
using Date = Custom.Date;

namespace App {
    public class Service {
        public void Run() {
            System.DateTime now = System.DateTime.UtcNow;
        }
    }
}
`
    const report = SanityChecker.checkSanity("Service.cs", csharpCode)
    expect(report.notice).toContain("Inline FQN 'System.DateTime' is forbidden in C#")
    expect(report.passed).toBe(false)
  })
})
