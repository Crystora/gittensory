import { describe, expect, it } from "vitest";
import minerPkg from "../../packages/gittensory-miner/package.json";
import type {
  CalibrationReport,
  CalibrationRow,
  ObservedOutcomeRecord,
  PredictedVerdictRecord,
} from "../../packages/gittensory-miner/src/index";

describe("gittensory-miner calibration scaffold", () => {
  it("publishes the calibration types through the built dist entrypoint", () => {
    expect(minerPkg.main).toBe("dist/index.js");
    expect(minerPkg.types).toBe("dist/index.d.ts");
    expect(minerPkg.exports["."]).toEqual({
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    });
    expect(minerPkg.files).toEqual(["bin", "dist", "lib"]);
  });

  it("wires package-local build and test scripts for the scaffold", () => {
    expect(minerPkg.scripts?.build).toBe(
      "tsc -p tsconfig.json && node --check bin/gittensory-miner.js && node --check lib/cli.js && node --check lib/update-check.js && node --check lib/opportunity-fanout.js",
    );
    expect(minerPkg.scripts?.test).toBe(
      "npm run build && tsc -p tsconfig.test.json && node --test \"dist-test/**/*.test.js\"",
    );
  });

  it("keeps minimal fixtures aligned with the shared calibration shapes", () => {
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

    expect(observed.outcome).toBe("merged");
    expect(report.rows[0]).toMatchObject({
      project: "octo/demo",
      mergeConfirmed: 1,
      wouldMerge: 1,
    });
  });
});
