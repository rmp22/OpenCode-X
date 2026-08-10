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

<table>
  <tr>
    <th>Inspect</th>
    <th>Plan</th>
    <th>Review</th>
  </tr>
  <tr>
    <td>Read source, instructions, and nearby code before editing.</td>
    <td>Use structure, strategy, and design records to set a clear change boundary.</td>
    <td>Keep evidence, checks, failures, and unknowns visible before completion.</td>
  </tr>
</table>

## OpenCode-X origin

OpenCode-X is an experimental fork of OpenCode focused on helping coding agents produce cleaner code when working with existing codebases.

I started this project because I kept seeing the usual AI slop from LLMs: unnecessary boilerplate, duplicated logic, pointless abstractions, and code that works but does not fit the existing codebase. OpenCode-X adds engineering rules, source inspection, and review steps to reduce these problems.

I also made OpenCode-X because I have carpal tunnel syndrome. I often use speech-to-text to reduce typing and mouse use, so I want coding agents to handle more of the typing while still following how I would normally work on the code. I hope it can also help other developers who rely on accessibility tools.

I mainly build and test OpenCode-X with fast, lower-cost models such as ChatGPT 5.6 Luna and DeepSeek. I do not need frontier models for most of my work because I write the specifications and make the engineering decisions myself. I only need a model that can understand what I ask, follow my specifications, and handle basic coding operations.

The rules in OpenCode-X come from my own development experience, books, research papers, developer feedback, and testing different LLMs. The project is still experimental and changes as I find problems and better ways to handle them.

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
