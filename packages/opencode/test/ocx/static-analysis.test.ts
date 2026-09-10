import { describe, expect, test } from "bun:test"
import {
  FqnGuard,
  ScopeAnalyzer,
  UnifiedStaticGate,
} from "../../src/ocx/static-analysis"

describe("Static Analysis - AST Scoping & FQN Guard", () => {
  describe("Java & AOSP Scenarios", () => {
    test("blocks inline FQN in Java methods (e.g. AOSP android.util.Log or Slog)", () => {
      const javaCode = `
package com.android.server.am;

import android.content.Context;

public class ActivityManagerService {
    private static final String TAG = "ActivityManager";

    public void logLifecycle(Context context) {
        android.util.Log.d(TAG, "Activity starting");
    }
}
`
      const result = UnifiedStaticGate.audit("ActivityManagerService.java", javaCode)
      expect(result.passed).toBe(false)
      const fqnDiag = result.diagnostics.find((d) => d.code === "ERR_INLINE_FQN")
      expect(fqnDiag).toBeDefined()
      expect(fqnDiag?.symbol).toBe("android.util.Log")
      expect(fqnDiag?.suggestedFix?.importToAdd).toBe("android.util.Log")
      expect(fqnDiag?.suggestedFix?.replacementText).toBe("Log")
    })

    test("allows inline FQN in Java when there is a documented naming collision and no aliasing exists", () => {
      const javaCodeWithCollision = `
package com.example.service;

import java.util.Date;

public class OrderService {
    public void processDates(Date utilDate) {
        java.sql.Date sqlDate = new java.sql.Date(utilDate.getTime());
    }
}
`
      const importedSymbols = [
        { name: "Date", fullPath: "java.util.Date", isWildcard: false, isStatic: false, line: 4 },
      ]
      const diagnostics = FqnGuard.check("OrderService.java", javaCodeWithCollision, importedSymbols)
      const fqnErrors = diagnostics.filter((d) => d.code === "ERR_INLINE_FQN")
      expect(fqnErrors.length).toBe(0)
    })

    test("detects missing imports (tunnel vision) in Java without compiling", () => {
      const javaCode = `
package com.example.service;

import java.util.List;

public class AsyncWorker {
    public void executeWork() {
        CompletableFuture.supplyAsync(() -> "done");
    }
}
`
      const result = ScopeAnalyzer.analyze("AsyncWorker.java", javaCode)
      expect(result.passed).toBe(false)
      const missing = result.diagnostics.find((d) => d.code === "ERR_UNRESOLVED_SYMBOL")
      expect(missing).toBeDefined()
      expect(missing?.symbol).toBe("CompletableFuture")
    })

    test("detects orphan/unused imports in Java", () => {
      const javaCode = `
package com.example.service;

import java.util.List;
import java.util.ArrayList;

public class TaskProcessor {
    public void run(List<String> items) {
        System.out.println(items.size());
    }
}
`
      const result = ScopeAnalyzer.analyze("TaskProcessor.java", javaCode)
      const orphan = result.diagnostics.find((d) => d.code === "ERR_ORPHAN_IMPORT")
      expect(orphan).toBeDefined()
      expect(orphan?.symbol).toBe("ArrayList")
      expect(orphan?.suggestedFix?.importToRemove).toBe("java.util.ArrayList")
    })
  })

  describe("Kotlin & Spring Boot Scenarios", () => {
    test("blocks inline FQN in Kotlin (e.g. Spring Boot ResponseEntity)", () => {
      const kotlinCode = `
package com.example.controller

class UserController {
    fun getUser(): Any {
        return org.springframework.http.ResponseEntity.ok("user")
    }
}
`
      const result = UnifiedStaticGate.audit("UserController.kt", kotlinCode)
      expect(result.passed).toBe(false)
      const fqnDiag = result.diagnostics.find((d) => d.code === "ERR_INLINE_FQN")
      expect(fqnDiag).toBeDefined()
      expect(fqnDiag?.symbol).toBe("org.springframework.http.ResponseEntity")
    })

    test("blocks inline FQN in Kotlin even on collision, requiring aliased import", () => {
      const kotlinCode = `
package com.example.service

import java.util.Date

class DateService {
    fun convert(utilDate: Date) {
        val sqlDate = java.sql.Date(utilDate.time)
    }
}
`
      const importedSymbols = [
        { name: "Date", fullPath: "java.util.Date", isWildcard: false, isStatic: false, line: 4 },
      ]
      const diagnostics = FqnGuard.check("DateService.kt", kotlinCode, importedSymbols)
      const fqnErrors = diagnostics.filter((d) => d.code === "ERR_INLINE_FQN")
      expect(fqnErrors.length).toBe(1)
      expect(fqnErrors[0].message).toContain("aliased import")
      expect(fqnErrors[0].suggestedFix?.aliasRequired).toBe(true)
    })

    test("passes clean Kotlin code using aliased imports", () => {
      const cleanKotlinCode = `
package com.example.service

import java.util.Date
import java.sql.Date as SqlDate

class DateService {
    fun convert(utilDate: Date): SqlDate {
        return SqlDate(utilDate.time)
    }
}
`
      const result = UnifiedStaticGate.audit("DateService.kt", cleanKotlinCode)
      expect(result.passed).toBe(true)
      expect(result.diagnostics.filter((d) => d.severity === "error").length).toBe(0)
    })
  })

  describe("Polyglot Adaptation (TypeScript, Python, Go, Rust)", () => {
    test("detects orphan imports in TypeScript", () => {
      const tsCode = `
import { readFile, writeFile } from "node:fs/promises"

export async function load(path: string) {
    return await readFile(path, "utf8")
}
`
      const result = ScopeAnalyzer.analyze("loader.ts", tsCode)
      const orphan = result.diagnostics.find((d) => d.code === "ERR_ORPHAN_IMPORT")
      expect(orphan).toBeDefined()
      expect(orphan?.symbol).toBe("writeFile")
    })

    test("detects orphan imports in Python", () => {
      const pyCode = `
import os
import sys

def get_cwd():
    return os.getcwd()
`
      const result = ScopeAnalyzer.analyze("utils.py", pyCode)
      const orphan = result.diagnostics.find((d) => d.code === "ERR_ORPHAN_IMPORT")
      expect(orphan).toBeDefined()
      expect(orphan?.symbol).toBe("sys")
    })

    test("detects orphan imports in Go", () => {
      const goCode = `
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("hello world")
}
`
      const result = ScopeAnalyzer.analyze("main.go", goCode)
      const orphan = result.diagnostics.find((d) => d.code === "ERR_ORPHAN_IMPORT")
      expect(orphan).toBeDefined()
      expect(orphan?.symbol).toBe("os")
    })

    test("detects orphan imports in Rust", () => {
      const rsCode = `
use std::collections::HashMap;
use std::collections::HashSet;

pub fn count_unique(items: Vec<i32>) -> usize {
    let mut map = HashMap::new();
    map.insert(1, 1);
    map.len()
}
`
      const result = ScopeAnalyzer.analyze("lib.rs", rsCode)
      const orphan = result.diagnostics.find((d) => d.code === "ERR_ORPHAN_IMPORT")
      expect(orphan).toBeDefined()
      expect(orphan?.symbol).toBe("HashSet")
    })
  })
})
