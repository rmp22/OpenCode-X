<p align="center">
  <picture>
    <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
    <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode-X logo">
  </picture>
</p>

<h1 align="center">OpenCode-X</h1>

<p align="center">
  A source-first coding agent for existing codebases.
</p>

<p align="center">
  <strong>Inspect first. Change deliberately. Verify the result.</strong>
</p>

<p align="center">
  <img src="packages/web/src/assets/lander/screenshot.png" alt="OpenCode-X terminal interface">
</p>

<hr>

## What OpenCode-X adds

OpenCode-X adds the OCX workflow layer to OpenCode. It keeps the agent's work
grounded in the repository instead of treating a prompt as an isolated coding
task:

- **Workflow control** selects a workflow and phase, tracks the active work,
  and keeps phase transitions explicit. See
  [`workflow.ts`](packages/opencode/src/ocx/workflow.ts) and
  [`workflow-runtime.ts`](packages/opencode/src/ocx/workflow-runtime.ts).
- **Source-first context** combines repository instructions, targeted search,
  structure guidance, and strategy playbooks before the agent changes files.
  The pipeline starts in [`ocx-pipeline.ts`](packages/opencode/src/ocx/ocx-pipeline.ts)
  and uses [`context/`](packages/opencode/src/ocx/context/),
  [`strategy.ts`](packages/opencode/src/ocx/strategy.ts), and
  [`semantic-bridge.ts`](packages/opencode/src/ocx/semantic-bridge.ts).
- **Planning and progress** provide durable plan/workstream state, task
  tracking, and concise progress checkpoints through
  [`plan-tool.ts`](packages/opencode/src/ocx/plan-tool.ts) and
  [`progress-tool.ts`](packages/opencode/src/ocx/progress-tool.ts).
- **Guarded actions** apply workflow, scope, path, shell, and tool-rail checks
  before operations are authorized. The boundary is implemented by
  [`workflow-gate`](packages/opencode/src/ocx/workflow-gate/),
  [`scope/`](packages/opencode/src/ocx/scope/),
  [`shell-policy.ts`](packages/opencode/src/ocx/shell-policy.ts),
  [`tool-rail.ts`](packages/opencode/src/ocx/tool-rail.ts), and
  [`mutation-guard.ts`](packages/opencode/src/ocx/mutation-guard.ts).
  Verification planning and the exit gate keep completion claims tied to
  evidence; see [`verification-planner.ts`](packages/opencode/src/ocx/verification-planner.ts)
  and [`exit-gate.ts`](packages/opencode/src/ocx/exit-gate.ts).
- **Durable session state** records workflow state, activity, and recovery
  data in the OCX store through
  [`ocx-db.ts`](packages/opencode/src/ocx/ocx-db.ts),
  [`ocx-session.ts`](packages/opencode/src/ocx/ocx-session.ts), and
  [`activity/`](packages/opencode/src/ocx/activity/).

These capabilities are implemented in the current checkout. The detailed
[OCX implementation guide](OCX.md) maps the runtime behavior to source files;
the [architecture redesign](specs/ocx-architecture-redesign.md) separates the
current baseline from explicitly planned work.

## OpenCode-X origin

OpenCode-X is an experimental fork of OpenCode focused on helping coding agents write cleaner code when working with existing codebases.

I started this project because I kept running into the same problems with LLM-generated code: unnecessary boilerplate, duplicated logic, needless abstractions, poor naming, and changes that technically work but do not fit the structure or style of the existing codebase. OpenCode-X adds engineering rules, codebase inspection, review steps, and other checks to reduce these problems.

I also made OpenCode-X because I have carpal tunnel syndrome. I often use speech-to-text to reduce typing and mouse use, so I want coding agents to handle more of the repetitive work while still following how I would normally approach the code. I hope it can also be useful to other developers who rely on accessibility tools.

I mainly build and test OpenCode-X with fast, lower-cost models such as ChatGPT 5.6 Luna, GLM 5.3 Flash, DeepSeek, Laguna S 2.1, and Ling-3.0-flash. I do not need frontier models for most of my work because I usually write the specifications and make the engineering decisions myself. I mainly need a model that can understand the task, follow the specification, inspect the existing code, and handle normal coding operations reliably. Because of this, many parts of OpenCode-X are designed and tuned around making these models more useful for software development.

The rules and systems in OpenCode-X come from my own development experience, books, research papers, developer feedback, existing engineering practices, and repeated testing across different LLMs. The project is still experimental, and I continue changing it as I find problems, test new ideas, and find better ways for coding agents to work with real codebases.

## Quick start

Build and deploy the local CLI from this checkout:

```bash
./build
./deploy
~/.ocx/bin/ocx --help
```

Start the terminal interface in a project directory:

```bash
~/.ocx/bin/ocx
```

The project is experimental. Expect the workflow rules and tools to change as
they are tested against more codebases and models.

## Agents

OpenCode-X includes two built-in agents that you can switch with `Tab`:

| Agent     | Use it for                               |
| --------- | ---------------------------------------- |
| **build** | Full-access development work.            |
| **plan**  | Read-only analysis and code exploration. |

The **general** subagent handles complex searches and multistep tasks. Use
`@general` when you need that additional exploration.

## Configuration

| Scope                 | Path             |
| --------------------- | ---------------- |
| Project configuration | `.ocx/`          |
| Global configuration  | `~/.config/ocx/` |
| CLI executable        | `ocx`            |

Project instructions live in `.ocx/AGENTS.md`. Keep that file short and store
only guidance that future coding sessions are likely to miss.

## Technical compatibility

Some package names, environment variables, and upstream identifiers still use
`opencode` for compatibility. The user-facing fork name, CLI, and project
configuration use **OpenCode-X**, `ocx`, and `.ocx`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before making changes. Keep commits
focused so reviewers can understand one bringup or patch at a time.
