import { describe, expect, it } from "vitest";
import {
  buildGateFalsePositiveReport,
  recordGateOutcomeForEvaluation,
  resolveMergedGateOutcome,
} from "../../src/services/gate-telemetry";
import { listGateOutcomes, recordGateBlockOutcome, resolveGateOutcome } from "../../src/db/repositories";
import { createTestEnv } from "../helpers/d1";
import type { GateCheckEvaluation } from "../../src/rules/advisory";
import type { GateOutcomeRecord, GateOutcomeResolution } from "../../src/types";

function outcome(blockerCodes: string[], resolution: GateOutcomeResolution | null = null, prNumber = 1): GateOutcomeRecord {
  return {
    repoFullName: "acme/widgets",
    prNumber,
    gatePack: "gittensor",
    blockerCodes,
    blockedAt: "2026-06-15T00:00:00.000Z",
    resolution,
    resolvedAt: resolution ? "2026-06-16T00:00:00.000Z" : null,
  };
}

function failureEval(codes: string[]): GateCheckEvaluation {
  return {
    enabled: true,
    conclusion: "failure",
    title: "Gittensory Gate: blocked",
    summary: "blocked",
    blockers: codes.map((code) => ({ code, title: code, severity: "warning", detail: "d" })),
    warnings: [],
  };
}

describe("buildGateFalsePositiveReport", () => {
  it("returns zeros for no recorded outcomes", () => {
    expect(buildGateFalsePositiveReport([])).toEqual({
      repoFullName: null,
      totalBlocked: 0,
      totalFalsePositives: 0,
      falsePositiveRate: 0,
      byGateType: [],
    });
  });

  it("aggregates overall and per-gate-type false-positive rates", () => {
    const report = buildGateFalsePositiveReport(
      [
        outcome(["missing_linked_issue", "duplicate_pr_risk"], null, 1),
        outcome(["missing_linked_issue"], "merged", 2),
        outcome(["duplicate_pr_risk", "slop_gate"], "overridden", 3),
      ],
      "acme/widgets",
    );
    expect(report).toEqual({
      repoFullName: "acme/widgets",
      totalBlocked: 3,
      totalFalsePositives: 2,
      falsePositiveRate: 0.667,
      byGateType: [
        { code: "duplicate_pr_risk", blocked: 2, falsePositives: 1, falsePositiveRate: 0.5 },
        { code: "missing_linked_issue", blocked: 2, falsePositives: 1, falsePositiveRate: 0.5 },
        { code: "slop_gate", blocked: 1, falsePositives: 1, falsePositiveRate: 1 },
      ],
    });
  });

  it("counts a blocker code at most once per outcome", () => {
    const report = buildGateFalsePositiveReport([outcome(["dup", "dup"], "merged")]);
    expect(report.byGateType).toEqual([{ code: "dup", blocked: 1, falsePositives: 1, falsePositiveRate: 1 }]);
  });
});

describe("gate outcome recording", () => {
  it("records a hard block from a failure evaluation and ignores non-blocking outcomes", async () => {
    const env = createTestEnv();
    await recordGateOutcomeForEvaluation(env, { repoFullName: "acme/widgets", prNumber: 7, gatePack: "gittensor", evaluation: failureEval(["duplicate_pr_risk"]) });
    await recordGateOutcomeForEvaluation(env, { repoFullName: "acme/widgets", prNumber: 8, gatePack: "gittensor", evaluation: { ...failureEval([]), conclusion: "success" } });
    await recordGateOutcomeForEvaluation(env, { repoFullName: "acme/widgets", prNumber: 9, gatePack: "gittensor", evaluation: undefined });

    const outcomes = await listGateOutcomes(env, "acme/widgets");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ prNumber: 7, gatePack: "gittensor", blockerCodes: ["duplicate_pr_risk"], resolution: null });
  });

  it("marks a blocked-then-merged PR as a false positive but leaves plain closes alone", async () => {
    const env = createTestEnv();
    await recordGateBlockOutcome(env, { repoFullName: "acme/widgets", prNumber: 1, gatePack: "gittensor", blockerCodes: ["slop_gate"] });
    await recordGateBlockOutcome(env, { repoFullName: "acme/widgets", prNumber: 2, gatePack: "gittensor", blockerCodes: ["slop_gate"] });

    await resolveMergedGateOutcome(env, "acme/widgets", 1, "closed", { merged_at: "2026-06-16T00:00:00.000Z" });
    await resolveMergedGateOutcome(env, "acme/widgets", 2, "closed", { merged_at: null }); // closed unmerged → not a false positive
    await resolveMergedGateOutcome(env, "acme/widgets", 1, "synchronize", { merged_at: "x" }); // non-close → no-op

    const report = buildGateFalsePositiveReport(await listGateOutcomes(env, "acme/widgets"), "acme/widgets");
    expect(report.totalBlocked).toBe(2);
    expect(report.totalFalsePositives).toBe(1);
  });

  it("re-blocking clears a prior resolution and resolve only touches unresolved rows", async () => {
    const env = createTestEnv();
    await recordGateBlockOutcome(env, { repoFullName: "acme/widgets", prNumber: 1, gatePack: "gittensor", blockerCodes: ["a"] });
    await resolveGateOutcome(env, "acme/widgets", 1, "merged");
    expect((await listGateOutcomes(env, "acme/widgets"))[0]?.resolution).toBe("merged");

    // Re-block clears the resolution; a subsequent resolve on a never-blocked PR is a no-op.
    await recordGateBlockOutcome(env, { repoFullName: "acme/widgets", prNumber: 1, gatePack: "gittensor", blockerCodes: ["a", "b"] });
    await resolveGateOutcome(env, "acme/widgets", 999, "merged");
    const rows = await listGateOutcomes(env, "acme/widgets");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resolution: null, blockerCodes: ["a", "b"] });
  });

  it("swallows write failures so telemetry never disrupts gate/webhook processing", async () => {
    const brokenEnv = {
      DB: {
        prepare() {
          throw new Error("db unavailable");
        },
      },
    } as unknown as Env;

    await expect(
      recordGateOutcomeForEvaluation(brokenEnv, { repoFullName: "acme/widgets", prNumber: 1, gatePack: "gittensor", evaluation: failureEval(["slop_gate"]) }),
    ).resolves.toBeUndefined();
    await expect(
      resolveMergedGateOutcome(brokenEnv, "acme/widgets", 1, "closed", { merged_at: "2026-06-16T00:00:00.000Z" }),
    ).resolves.toBeUndefined();
  });

  it("lists outcomes scoped to a repo or across all repos", async () => {
    const env = createTestEnv();
    await recordGateBlockOutcome(env, { repoFullName: "acme/a", prNumber: 1, gatePack: "gittensor", blockerCodes: ["x"] });
    await recordGateBlockOutcome(env, { repoFullName: "acme/b", prNumber: 1, gatePack: "gittensor", blockerCodes: ["y"] });
    expect(await listGateOutcomes(env, "acme/a")).toHaveLength(1);
    expect(await listGateOutcomes(env)).toHaveLength(2);
  });
});
