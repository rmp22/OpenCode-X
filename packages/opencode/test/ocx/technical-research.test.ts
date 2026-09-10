import { describe, expect, test } from "bun:test"
import {
  evaluateResearch,
  type SourceRecord,
  type ResearchClaimLink,
  type ResearchCoverage,
} from "@/ocx/research"

describe("Technical Research Evaluator & Provenance", () => {
  test("rejects research completion when only a single artifact is inspected", () => {
    const singleSource: SourceRecord[] = [
      {
        id: "src_1",
        locator: "packages/core/src/auth.ts",
        type: "file",
        authority: "primary_source_code",
        timestamp: Date.now(),
        freshnessScore: 1.0,
        sectionsUsed: ["lines 1-50"],
      },
    ]

    const coverage: ResearchCoverage = {
      primaryQuestion: "How does token rotation work?",
      subquestions: ["What is expiration policy?", "Where is refresh handled?"],
      addressedSubquestions: ["What is expiration policy?"],
      queriesExecuted: ["rg token rotation"],
      identifiedGaps: [],
      unresolvedContradictions: [],
    }

    const claims: ResearchClaimLink[] = [
      {
        claimId: "c1",
        statement: "Tokens rotate every 15 minutes",
        supportingSourceIds: ["src_1"],
        supportingSpans: ["exp = 900"],
        contradictingSourceIds: [],
        uncertainty: "none",
      },
    ]

    const evalResult = evaluateResearch(coverage, singleSource, claims)
    expect(evalResult.isComplete).toBe(false)
    expect(evalResult.reason).toContain("cannot equal reading one single artifact")
  })

  test("blocks completion when unresolved contradictions exist", () => {
    const sources: SourceRecord[] = [
      {
        id: "src_1",
        locator: "https://spec.auth.org/v2",
        type: "api_spec",
        authority: "official_spec",
        timestamp: Date.now(),
        freshnessScore: 1.0,
        sectionsUsed: ["section 3.2"],
      },
      {
        id: "src_2",
        locator: "https://blog.community.io/auth-v2-notes",
        type: "web_url",
        authority: "community",
        timestamp: Date.now() - 1000 * 60 * 60 * 24 * 60,
        freshnessScore: 0.6,
        sectionsUsed: ["paragraph 4"],
      },
    ]

    const coverage: ResearchCoverage = {
      primaryQuestion: "Does OAuth2 spec require PKCE for confidential clients?",
      subquestions: ["Specification stance", "Community implementation stance"],
      addressedSubquestions: ["Specification stance", "Community implementation stance"],
      queriesExecuted: ["oauth2 spec pkce confidential", "community pkce practices"],
      identifiedGaps: [],
      unresolvedContradictions: [
        "Official spec marks PKCE as recommended, community guide asserts it is mandatory",
      ],
    }

    const claims: ResearchClaimLink[] = [
      {
        claimId: "c_pkce",
        statement: "PKCE status for confidential clients",
        supportingSourceIds: ["src_1"],
        supportingSpans: ["section 3.2: SHOULD use PKCE"],
        contradictingSourceIds: ["src_2"],
        uncertainty: "medium",
      },
    ]

    const evalResult = evaluateResearch(coverage, sources, claims)
    expect(evalResult.isComplete).toBe(false)
    expect(evalResult.reason).toContain("unresolved contradictions")
    expect(evalResult.contradictionHandlingScore).toBeLessThan(0.5)
  })

  test("approves research with official sources, addressed subquestions, and zero gaps", () => {
    const sources: SourceRecord[] = [
      {
        id: "src_spec",
        locator: "https://datatracker.ietf.org/doc/html/rfc9700",
        type: "api_spec",
        authority: "official_spec",
        timestamp: Date.now(),
        freshnessScore: 1.0,
        sectionsUsed: ["Section 2.1", "Section 4.3"],
      },
      {
        id: "src_impl",
        locator: "packages/core/src/auth/provider.ts",
        type: "file",
        authority: "primary_source_code",
        timestamp: Date.now(),
        freshnessScore: 1.0,
        sectionsUsed: ["lines 40-120"],
      },
    ]

    const coverage: ResearchCoverage = {
      primaryQuestion: "How is session resumption handled in RFC9700?",
      subquestions: ["Ticket format", "Replay defense"],
      addressedSubquestions: ["Ticket format", "Replay defense"],
      queriesExecuted: ["rfc9700 session ticket", "replay defense implementation"],
      identifiedGaps: [],
      unresolvedContradictions: [],
    }

    const claims: ResearchClaimLink[] = [
      {
        claimId: "c1",
        statement: "Session tickets use AES-GCM with rotating keys",
        supportingSourceIds: ["src_spec", "src_impl"],
        supportingSpans: ["RFC9700 §2.1", "provider.ts:45"],
        contradictingSourceIds: [],
        uncertainty: "none",
      },
      {
        claimId: "c2",
        statement: "Anti-replay cache uses bloom filter with TTL",
        supportingSourceIds: ["src_impl"],
        supportingSpans: ["provider.ts:88"],
        contradictingSourceIds: [],
        uncertainty: "none",
      },
    ]

    const evalResult = evaluateResearch(coverage, sources, claims)
    expect(evalResult.isComplete).toBe(true)
    expect(evalResult.overallQuality).toBeGreaterThanOrEqual(0.8)
    expect(evalResult.sourceQualityScore).toBe(1.0)
    expect(evalResult.coverageScore).toBe(1.0)
    expect(evalResult.claimSupportScore).toBe(1.0)
  })
})
