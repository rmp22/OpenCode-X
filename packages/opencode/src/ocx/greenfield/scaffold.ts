import type {
  ProjectSkeleton,
  GreenfieldPresetType,
  ScaffoldPlan,
  ScaffoldStep,
} from "./types"

export function generateVerticalSliceScaffold(projectName: string): ProjectSkeleton {
  const skeleton = generateProjectSkeleton(projectName, "node-ts")
  return skeleton
}

export function generateProjectSkeleton(
  projectName: string,
  preset: GreenfieldPresetType,
): ProjectSkeleton {
  if (preset === "rust") {
    const cargoToml = `[package]
name = "${projectName}"
version = "0.1.0"
edition = "2021"

[dependencies]
`
    const mainRs = "pub fn hello() -> &'static str {\n    \"world\"\n}\n"
    const testRs = `use ${projectName.replace(/-/g, "_")}::hello;

#[test]
fn test_hello() {
    assert_eq!(hello(), "world");
}
`
    const skeleton: ProjectSkeleton = {
      name: projectName,
      entryPoint: "src/lib.rs",
      testRunner: "cargo test",
      files: [
        { relativePath: "Cargo.toml", content: cargoToml },
        { relativePath: "src/lib.rs", content: mainRs },
        { relativePath: "tests/integration_test.rs", content: testRs },
      ],
    }
    return skeleton
  }

  if (preset === "go") {
    const goMod = `module ${projectName}

go 1.22
`
    const mainGo = "package main\n\nfunc Hello() string {\n    " + "return \"world\"\n}\n"
    const testGo = `package main

import "testing"

func TestHello(t *testing.T) {
    if Hello() != "world" {
        t.Fatalf("expected world, got %s", Hello())
    }
}
`
    const skeleton: ProjectSkeleton = {
      name: projectName,
      entryPoint: "main.go",
      testRunner: "go test ./...",
      files: [
        { relativePath: "go.mod", content: goMod },
        { relativePath: "main.go", content: mainGo },
        { relativePath: "main_test.go", content: testGo },
      ],
    }
    return skeleton
  }

  if (preset === "python") {
    const pyprojectToml = `[project]
name = "${projectName}"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = []

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
`
    const mainPy = "def hello() -> str:\n    " + "return \"world\"\n"
    const testPy = `from src.main import hello

def test_hello():
    assert hello() == "world"
`
    const skeleton: ProjectSkeleton = {
      name: projectName,
      entryPoint: "src/main.py",
      testRunner: "pytest",
      files: [
        { relativePath: "pyproject.toml", content: pyprojectToml },
        { relativePath: "src/__init__.py", content: "" },
        { relativePath: "src/main.py", content: mainPy },
        { relativePath: "tests/__init__.py", content: "" },
        { relativePath: "tests/test_main.py", content: testPy },
      ],
    }
    return skeleton
  }

  if (preset === "java") {
    const pomXml = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>${projectName}</artifactId>
  <version>0.1.0</version>
  <properties>
    <maven.compiler.source>21</maven.compiler.source>
    <maven.compiler.target>21</maven.compiler.target>
  </properties>
</project>
`
    const appJava = "package com.example;\n\npublic class App {\n    public static String hello() {\n        " + "return \"world\";\n    }\n}\n"
    const testJava = `package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class AppTest {
    @Test
    public void testHello() {
        assertEquals("world", App.hello());
    }
}
`
    const skeleton: ProjectSkeleton = {
      name: projectName,
      entryPoint: "src/main/java/com/example/App.java",
      testRunner: "mvn test",
      files: [
        { relativePath: "pom.xml", content: pomXml },
        { relativePath: "src/main/java/com/example/App.java", content: appJava },
        { relativePath: "src/test/java/com/example/AppTest.java", content: testJava },
      ],
    }
    return skeleton
  }

  const packageJson = JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      type: "module",
      scripts: {
        test: "bun test",
        typecheck: "tsc --noEmit",
      },
    },
    null,
    2,
  )

  const tsConfig = JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
      },
      include: ["src/**/*", "test/**/*"],
    },
    null,
    2,
  )

  const indexTs = "export function hello(): string {\n  " + "return \"world\"\n}\n"

  const testTs = `import { describe, expect, test } from "bun:test"
import { hello } from "../src/index"

describe("${projectName}", () => {
  test("smoke test passes", () => {
    expect(hello()).toBe("world")
  })
})
`

  const skeleton: ProjectSkeleton = {
    name: projectName,
    entryPoint: "src/index.ts",
    testRunner: "bun test",
    files: [
      { relativePath: "package.json", content: packageJson },
      { relativePath: "tsconfig.json", content: tsConfig },
      { relativePath: "src/index.ts", content: indexTs },
      { relativePath: "test/index.test.ts", content: testTs },
    ],
  }
  return skeleton
}

export function createScaffoldPlan(
  projectName: string,
  preset: GreenfieldPresetType,
): ScaffoldPlan {
  const skeleton = generateProjectSkeleton(projectName, preset)
  const configTarget = skeleton.files[0]?.relativePath ?? "config"
  const entryTarget = skeleton.entryPoint
  const testTarget = skeleton.files[skeleton.files.length - 1]?.relativePath ?? "tests"

  const steps: readonly ScaffoldStep[] = [
    {
      phase: "config/build",
      target: configTarget,
      description: `Initialize project configuration (${configTarget})`,
    },
    {
      phase: "entrypoint",
      target: entryTarget,
      description: `Implement primary entry point (${entryTarget})`,
    },
    {
      phase: "test",
      target: testTarget,
      description: `Add baseline test suite (${testTarget})`,
    },
    {
      phase: "verify",
      target: skeleton.testRunner,
      description: `Execute test runner verification (${skeleton.testRunner})`,
    },
  ]

  const plan: ScaffoldPlan = {
    preset,
    steps,
    skeleton,
  }
  return plan
}
