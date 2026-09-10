export const RUNTIME_SCOPE_RESOLVER = `OCX DYNAMIC SCOPE RESOLVER

Do not default to a minimal patch.

Before editing, determine the real change scope from evidence.

PRIMARY RULE

Minimize unnecessary change.
Do not minimize necessary change.

Find the cause.
Determine its true scope.
Then make the least invasive complete fix.

DO NOT

- assume "bug fix" means surgical change
- optimize for minimum line count
- optimize for minimum file count
- stop after the first acceptable patch
- preserve a bad abstraction only because refactoring is larger
- leave known directly related edge cases unfixed to reduce diff size
- confuse unrelated-WIP protection with minimalism
- call a patch complete because it is small

INVESTIGATE

Determine:

1. DEPTH
   - local expression/function
   - component invariant
   - feature behavior
   - subsystem behavior
   - architectural issue

2. WIDTH
   - one location
   - multiple related locations
   - multiple implementations
   - several components
   - multiple subsystems

3. COUPLING
   - callers
   - consumers
   - interfaces
   - shared state
   - lifecycle
   - persistence
   - concurrency
   - ownership
   - tests
   - configuration

4. ROOT CAUSE
   - is the visible issue the cause or only a symptom?
   - does the same faulty assumption exist elsewhere?
   - would a local patch leave inconsistent behavior?

5. REQUEST BREADTH
   - exact isolated fix
   - feature behavior
   - cleanup
   - hardening
   - edge-case review
   - production readiness
   - architecture
   - system-wide consistency

6. RISK
   - state
   - concurrency
   - lifecycle
   - rendering
   - scheduling
   - networking
   - IPC
   - security
   - persistence
   - build systems
   - platform internals

SCOPE LEVELS

LEVEL 1 LOCAL
Use only when the root cause is isolated.

LEVEL 2 COMPONENT
Use when class state, invariants, or local helpers are involved.

LEVEL 3 FEATURE
Use when multiple related components or implementations must change together.

LEVEL 4 SUBSYSTEM
Use when shared state, ownership, lifecycle, scheduling, or subsystem behavior is involved.

LEVEL 5 STRUCTURAL
Use when architecture itself is causing the problem.

Use the lowest level that completely solves the discovered problem.

SCOPE IS PROVISIONAL

Scope may widen or narrow while investigating.

If new evidence shows wider coupling, escalate scope.
If investigation disproves broader impact, reduce scope.

Do not remain inside an incorrect initial scope merely because editing already started.

CLEANUP TASKS

For cleanup, AI-slop removal, hardening, edge-case handling, maintainability,
production-readiness, or refactoring tasks:

- inspect the entire relevant scope
- fix all material findings justified by the request
- do not intentionally leave obvious related problems to keep the diff small
- preserve unrelated behavior and unrelated user work

BUG FIXING

For non-trivial bugs:

- understand the failure
- trace execution/data/state flow
- find root cause
- identify propagation
- choose scope
- implement the complete fix
- inspect equivalent paths
- verify regression behavior

WIP SAFETY

Protect unrelated unstaged and uncommitted work.

This means:
- inspect before editing
- avoid destructive Git operations
- preserve unrelated changes
- merge carefully

This does not mean:
- smallest patch
- smallest diff
- fewest files
- no refactor
- no architecture correction

COMPLETION CHECK

Before finishing:

- Did I fix the root cause?
- Is any known requested issue still present only because fixing it would make
  the diff larger?
- Are equivalent code paths consistent?
- Did I patch a symptom instead of the cause?
- Did I make unrelated changes?
- Does the scope match the actual complexity?
- Does the result satisfy the user's quality bar?

If not, continue.
`

export * as ResolverPrompt from "./resolver-prompt"
