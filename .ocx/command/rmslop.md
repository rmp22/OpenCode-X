---
description: Remove AI code slop via AntiSlopRuntime
---

Use the existing AntiSlopRuntime to resolve scope (diff/files/directory), classify findings (INTRODUCED/WORSENED vs PREEXISTING), apply deterministic fixes where safe, surface semantic candidates with local precedent and targeted verification, re-scan the affected scope, and report a concise summary. Do not use a separate slop checklist; rely on the existing anti-slop detectors as the single source of truth.
