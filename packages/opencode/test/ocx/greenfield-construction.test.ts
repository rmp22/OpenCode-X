import { describe, expect, test } from "bun:test"
import {
  isBoilerplateName,
  isBoilerplateOnly,
  inferProjectPreset,
} from "../../src/ocx/greenfield/detector"
import {
  generateProjectSkeleton,
  createScaffoldPlan,
} from "../../src/ocx/greenfield/scaffold"

describe("Greenfield Construction Runtime Wiring", () => {
  test("boilerplate detection classifies repo boilerplate correctly", () => {
    expect(isBoilerplateName("README.md")).toBe(true)
    expect(isBoilerplateName(".gitignore")).toBe(true)
    expect(isBoilerplateName("LICENSE")).toBe(true)
    expect(isBoilerplateName("contributing.md")).toBe(true)
    expect(isBoilerplateName("src/index.ts")).toBe(false)
    expect(isBoilerplateName("package.json")).toBe(false)
  })

  test("isBoilerplateOnly identifies greenfield boilerplate workspaces", () => {
    expect(isBoilerplateOnly([])).toBe(true)
    expect(isBoilerplateOnly([".git", "README.md", "LICENSE", ".gitignore"])).toBe(true)
    expect(isBoilerplateOnly(["README.md", "src/main.ts"])).toBe(false)
    expect(isBoilerplateOnly(["package.json", "tsconfig.json"])).toBe(false)
  })

  test("inferProjectPreset selects correct language preset based on hints", () => {
    expect(inferProjectPreset("Create a rust CLI tool with Cargo")).toBe("rust")
    expect(inferProjectPreset("Build a Go web service")).toBe("go")
    expect(inferProjectPreset("Python data pipeline using pyproject.toml")).toBe("python")
    expect(inferProjectPreset("Java spring service with pom.xml")).toBe("java")
    expect(inferProjectPreset("TypeScript react frontend")).toBe("node-ts")
    expect(inferProjectPreset(undefined)).toBe("node-ts")
  })

  test("generateProjectSkeleton generates valid skeletons across presets", () => {
    const presets = ["node-ts", "python", "rust", "go", "java"] as const
    for (const preset of presets) {
      const skel = generateProjectSkeleton("demo-app", preset)
      expect(skel.name).toBe("demo-app")
      expect(skel.entryPoint.length).toBeGreaterThan(0)
      expect(skel.testRunner.length).toBeGreaterThan(0)
      expect(skel.files.length).toBeGreaterThan(1)
    }
  })

  test("createScaffoldPlan sequences config/build -> entrypoint -> test -> verify", () => {
    const plan = createScaffoldPlan("demo-app", "rust")
    expect(plan.steps.length).toBe(4)
    expect(plan.steps[0].phase).toBe("config/build")
    expect(plan.steps[1].phase).toBe("entrypoint")
    expect(plan.steps[2].phase).toBe("test")
    expect(plan.steps[3].phase).toBe("verify")
    expect(plan.steps[3].target).toBe("cargo test")
  })
})
