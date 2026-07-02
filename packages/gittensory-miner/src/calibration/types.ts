// Shared calibration scaffold for the miner package (#2332). This module is intentionally structural only:
// follow-up issues add the report builder, prediction ledger, and metrics exporter on top of these shared
// shapes without re-deciding naming or module boundaries.

/** The deterministic gate verdict a miner predicted for one target. */
export type PredictedVerdict = "merge" | "close" | "hold";

/** The realized terminal outcome used to grade a prediction. */
export type ObservedOutcome = "merged" | "closed";

/** One stored prediction to be graded later. `project` mirrors GateEvalRow.project; `targetId` and `headSha`
 *  keep enough identity to build both per-target ledgers and per-commit reports in follow-up issues. */
export interface PredictedVerdictRecord {
  project: string;
  targetId: string;
  headSha: string | null;
  source: string;
  verdict: PredictedVerdict;
  predictedAt: string;
}

/** The realized terminal outcome for a previously predicted target. `headSha` is nullable because the final
 *  outcome may be known even when the terminal commit SHA is unavailable or not worth persisting. */
export interface ObservedOutcomeRecord {
  project: string;
  targetId: string;
  headSha: string | null;
  outcome: ObservedOutcome;
  observedAt: string;
}

/** Per-project confusion matrix + precisions for the miner's prediction vs the realized outcome. Field names
 *  deliberately mirror src/review/parity.ts's GateEvalRow for easy mental mapping without importing app code. */
export interface CalibrationRow {
  project: string;
  wouldMerge: number;
  mergeConfirmed: number;
  mergeFalse: number;
  wouldClose: number;
  closeConfirmed: number;
  closeFalse: number;
  hold: number;
  decided: number;
  mergePrecision: number | null;
  closePrecision: number | null;
}

/** The miner package's calibration report: per-project rows plus a coarse enough-data flag. */
export interface CalibrationReport {
  rows: CalibrationRow[];
  hasSignal: boolean;
}
