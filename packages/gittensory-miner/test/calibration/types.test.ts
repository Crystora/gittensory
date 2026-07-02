import assert from "node:assert/strict";
import test from "node:test";

import type {
  CalibrationReport,
  CalibrationRow,
  ObservedOutcomeRecord,
  PredictedVerdictRecord,
} from "../../dist/index.js";

test("calibration scaffold fixtures satisfy the shared miner shapes", () => {
  const predicted: PredictedVerdictRecord = {
    project: "octo/demo",
    targetId: "pr:42",
    headSha: "abc123",
    source: "miner-shadow",
    verdict: "merge",
    predictedAt: "2026-07-01T00:00:00.000Z",
  };
  const observed: ObservedOutcomeRecord = {
    project: predicted.project,
    targetId: predicted.targetId,
    headSha: predicted.headSha,
    outcome: "merged",
    observedAt: "2026-07-02T00:00:00.000Z",
  };
  const row: CalibrationRow = {
    project: predicted.project,
    wouldMerge: 1,
    mergeConfirmed: 1,
    mergeFalse: 0,
    wouldClose: 0,
    closeConfirmed: 0,
    closeFalse: 0,
    hold: 0,
    decided: 1,
    mergePrecision: 1,
    closePrecision: null,
  };
  const report: CalibrationReport = {
    rows: [row],
    hasSignal: false,
  };

  assert.equal(observed.outcome, "merged");
  assert.equal(report.rows[0]?.project, predicted.project);
  assert.equal(report.rows[0]?.mergeConfirmed, 1);
});
