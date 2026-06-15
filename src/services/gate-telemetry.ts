import type { GateCheckEvaluation } from "../rules/advisory";
import { recordGateBlockOutcome, resolveGateOutcome } from "../db/repositories";
import type { GateFalsePositiveRate, GateFalsePositiveReport, GateOutcomeRecord, GitHubPullRequestPayload } from "../types";

// Gate false-positive telemetry (#554). Maintainers won't move a gate from advisory to block without
// evidence it is precise, so we record every hard-block and correlate it with the PR's eventual merge or
// override to expose a per-gate-type false-positive rate. Pure aggregation + thin, branch-light recording
// helpers (the branching lives here so the deep webhook processor stays a straight-line call site).

/**
 * Record a gate hard-block (conclusion `failure`) for later false-positive correlation. No-op for any
 * non-blocking outcome — only confirmed-contributor hard blocks reach `failure`, so advisory/neutral runs
 * are never counted.
 */
export async function recordGateOutcomeForEvaluation(
  env: Env,
  args: { repoFullName: string; prNumber: number; gatePack: string; evaluation: GateCheckEvaluation | undefined },
): Promise<void> {
  if (!args.evaluation || args.evaluation.conclusion !== "failure") return;
  // Best-effort telemetry: a write failure must never disrupt gate/webhook processing.
  try {
    await recordGateBlockOutcome(env, {
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      gatePack: args.gatePack,
      blockerCodes: args.evaluation.blockers.map((blocker) => blocker.code),
    });
  } catch {
    return;
  }
}

/**
 * A previously gate-blocked PR that is later merged is a false positive — the block did not reflect a real
 * defect. Resolves only on merge; a plain close is a true positive (the block held), and PRs that were
 * never blocked are unaffected (the DB update only touches an existing unresolved row).
 */
export async function resolveMergedGateOutcome(
  env: Env,
  repoFullName: string,
  prNumber: number,
  action: string | undefined,
  pullRequest: Pick<GitHubPullRequestPayload, "merged_at">,
): Promise<void> {
  if (action !== "closed" || !pullRequest.merged_at) return;
  // Best-effort telemetry: a write failure must never disrupt gate/webhook processing.
  try {
    await resolveGateOutcome(env, repoFullName, prNumber, "merged");
  } catch {
    return;
  }
}

/**
 * Aggregate a false-positive rate overall and per gate type (blocker code). A "false positive" is any
 * recorded block whose outcome was later resolved (merged or overridden).
 */
export function buildGateFalsePositiveReport(
  outcomes: GateOutcomeRecord[],
  repoFullName: string | null = null,
): GateFalsePositiveReport {
  const byCode = new Map<string, { blocked: number; falsePositives: number }>();
  let totalBlocked = 0;
  let totalFalsePositives = 0;

  for (const outcome of outcomes) {
    totalBlocked += 1;
    const falsePositive = outcome.resolution != null;
    if (falsePositive) totalFalsePositives += 1;
    for (const code of new Set(outcome.blockerCodes)) {
      const entry = byCode.get(code) ?? { blocked: 0, falsePositives: 0 };
      entry.blocked += 1;
      if (falsePositive) entry.falsePositives += 1;
      byCode.set(code, entry);
    }
  }

  const byGateType: GateFalsePositiveRate[] = [...byCode.entries()]
    .map(([code, entry]) => ({
      code,
      blocked: entry.blocked,
      falsePositives: entry.falsePositives,
      falsePositiveRate: rate(entry.falsePositives, entry.blocked),
    }))
    .sort((left, right) => left.code.localeCompare(right.code));

  return {
    repoFullName,
    totalBlocked,
    totalFalsePositives,
    falsePositiveRate: rate(totalFalsePositives, totalBlocked),
    byGateType,
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 1000;
}
