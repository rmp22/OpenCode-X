import { describe, expect, test } from "bun:test"
import { GraphEngine } from "@/ocx/graph"
import { PolicyEngine } from "@/ocx/policy"
import { apply as applyGate } from "@/ocx/turn/gate"
import { EvidenceCollector, EvidenceVerifier } from "@/ocx/evidence"
import { ClaimLifecycleManager } from "@/ocx/claims"
import { SuspensionManager } from "@/ocx/suspension"
import { EventJournal, GraphRecoveryEngine } from "@/ocx/events"
import { LoopController } from "@/ocx/loops"
import { LaneScheduler } from "@/ocx/lanes"
import { CAPABILITY_PROFILES } from "@/ocx/graph/capabilities"

describe("Production Gate End-to-End Evaluations", () => {
  test("Scenario 1: Clean Code Mutation Pipeline", () => {
    const graph = {
      id: "code-mutation-eval",
      pipelineId: "code-mutation-pipeline",
      initialNodeId: "plan",
      terminalNodeIds: ["complete"],
      nodes: [
        { id: "plan", label: "Plan", kind: "initial" as const, allowedTools: CAPABILITY_PROFILES.PLANNING.allowedTools, deniedTools: CAPABILITY_PROFILES.PLANNING.deniedTools },
        { id: "change", label: "Change", kind: "intermediate" as const, allowedTools: CAPABILITY_PROFILES.EXECUTION.allowedTools, deniedTools: [] },
        { id: "verify", label: "Verify", kind: "intermediate" as const, allowedTools: CAPABILITY_PROFILES.VERIFICATION.allowedTools, deniedTools: CAPABILITY_PROFILES.VERIFICATION.deniedTools },
        { id: "complete", label: "Complete", kind: "terminal" as const },
      ],
      edges: [
        { from: "plan", to: "change" },
        { from: "change", to: "verify" },
        { from: "verify", to: "complete" },
      ],
    }

    const sessionID = `eval_s1_${Date.now()}`
    const engine = new GraphEngine({ graph, sessionID })
    expect(engine.getCurrentNode()).toBe("plan")

    const mockTools: Record<string, any> = {
      read: { description: "read" },
      write: { description: "write" },
      edit: { description: "edit" },
      bash: { description: "bash" },
    }
    applyGate(true, 1, mockTools, {
      phase: "plan",
      node: graph.nodes[0],
    })
    expect(mockTools.read).toBeDefined()
    expect(mockTools.write).toBeUndefined()
    expect(mockTools.edit).toBeUndefined()

    const toChange = engine.transition("change")
    expect(toChange.status).toBe("advanced")

    const collector = new EvidenceCollector()
    collector.ingestFileMutation("edit", "packages/core/auth.ts", "+10 lines")

    const toVerify = engine.transition("verify")
    expect(toVerify.status).toBe("advanced")

    collector.ingestBashOutput("bun test test/auth.test.ts", "15 pass, 0 fail", 0)

    const evidenceItems = collector.getItems()
    const verification = EvidenceVerifier.verify("code-mutation-pipeline", evidenceItems)
    expect(verification.satisfied).toBe(true)

    const claimMgr = new ClaimLifecycleManager()
    const claim = claimMgr.assert({
      nodeId: "verify",
      assertion: "Auth tests passing",
      citations: [{ filePath: "packages/core/auth.ts", lineNumber: 15 }],
    })
    claimMgr.registerEvidence(evidenceItems[0].id)
    const verifiedClaim = claimMgr.verify(claim.id, [evidenceItems[0].id])
    expect(verifiedClaim.success).toBe(true)
    expect(claimMgr.canComplete("verify").allowed).toBe(true)

    const finalResult = engine.transition("complete")
    expect(finalResult.status).toBe("completed")
  })

  test("Scenario 2: Interactive Exploration Pipeline", async () => {
    const evalPolicy = PolicyEngine.evaluate("write", { allowedCategories: ["read"] })
    expect(evalPolicy.allowed).toBe(false)

    const readPolicy = PolicyEngine.evaluate("read", { allowedCategories: ["read"] })
    expect(readPolicy.allowed).toBe(true)

    const collector = new EvidenceCollector()
    collector.ingestRead("README.md")
    collector.ingestRead("src/index.ts")

    const verif = EvidenceVerifier.verify("interactive-exploration-pipeline", collector.getItems())
    expect(verif.satisfied).toBe(true)

    const scheduler = new LaneScheduler()
    const taskResult = await scheduler.enqueue("fast", async () => {
      return "exploration complete"
    })
    expect(taskResult.success).toBe(true)
    if (taskResult.success) {
      expect(taskResult.result).toBe("exploration complete")
    }
  })

  test("Scenario 3: Crash Recovery & Typed Suspension", () => {
    const sessionID = `eval_s3_${Date.now()}`
    const journal = new EventJournal(sessionID)
    const suspMgr = new SuspensionManager()

    journal.append({ type: "node_entered", nodeId: "plan", timestamp: 100 })
    journal.append({ type: "node_entered", nodeId: "change", timestamp: 200 })

    const susp = suspMgr.suspend({
      sessionID,
      nodeId: "change",
      kind: "user_input",
      prompt: "Confirm branch name?",
    })
    journal.append({
      type: "suspended",
      kind: "user_input",
      reason: "Confirm branch name?",
      timestamp: 300,
    })

    const recovered = GraphRecoveryEngine.replay(journal.readAll(), "plan")
    expect(recovered.currentNode).toBe("change")
    expect(recovered.isSuspended).toBe(true)
    expect(recovered.activeSuspensionReason).toBe("Confirm branch name?")

    const resumeRes = suspMgr.resume(sessionID, susp.id, "feat-session-recovery")
    expect(resumeRes.success).toBe(true)

    journal.append({
      type: "resumed",
      suspensionId: susp.id,
      timestamp: 400,
    })

    const resumedState = GraphRecoveryEngine.replay(journal.readAll(), "plan")
    expect(resumedState.currentNode).toBe("change")
    expect(resumedState.isSuspended).toBe(false)
  })

  test("Scenario 4: Stuck Loop Escalation Ladder", () => {
    const loopCtrl = new LoopController()

    loopCtrl.recordToolCall("read", "config.json")
    expect(loopCtrl.evaluate().level).toBe(0)

    loopCtrl.recordToolCall("read", "config.json")
    const lvl1 = loopCtrl.evaluate()
    expect(lvl1.level).toBe(1)
    expect(lvl1.kind).toBe("advisory")

    loopCtrl.recordToolCall("read", "config.json")
    const lvl2 = loopCtrl.evaluate()
    expect(lvl2.level).toBe(2)
    expect(lvl2.kind).toBe("strict_instruction")

    loopCtrl.reset()
    for (let i = 0; i < 5; i++) {
      loopCtrl.recordError("bash")
    }
    const lvl3 = loopCtrl.evaluate()
    expect(lvl3.level).toBe(3)
    expect(lvl3.kind).toBe("suspension")
  })
})
