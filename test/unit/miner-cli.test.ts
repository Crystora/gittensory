import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bin,
  closeFixtureServer,
  runCapture,
  startRegistryFixture,
} from "./support/miner-cli-harness";

type MinerCli = typeof import("../../packages/gittensory-miner/lib/cli.js");
type MinerLaptop =
  typeof import("../../packages/gittensory-miner/lib/laptop-init.js");
type MinerUpdateCheck =
  typeof import("../../packages/gittensory-miner/lib/update-check.js");

const tempRoots: string[] = [];

let printHelp: MinerCli["printHelp"];
let printVersion: MinerCli["printVersion"];
let runCli: MinerCli["runCli"];
let formatLaptopDoctor: MinerLaptop["formatLaptopDoctor"];
let initLaptopMode: MinerLaptop["initLaptopMode"];
let inspectLaptopDoctor: MinerLaptop["inspectLaptopDoctor"];
let resolveLaptopPaths: MinerLaptop["resolveLaptopPaths"];
let compareSemver: MinerUpdateCheck["compareSemver"];
let fetchLatestPackageVersion: MinerUpdateCheck["fetchLatestPackageVersion"];
let maybePrintUpdateNudge: MinerUpdateCheck["maybePrintUpdateNudge"];
let resolveNpmRegistryUrl: MinerUpdateCheck["resolveNpmRegistryUrl"];
let resolveUpgradeCommand: MinerUpdateCheck["resolveUpgradeCommand"];
let shouldSkipUpdateCheck: MinerUpdateCheck["shouldSkipUpdateCheck"];
let startUpdateCheck: MinerUpdateCheck["startUpdateCheck"];
let awaitOpportunisticUpdateCheck: MinerUpdateCheck["awaitOpportunisticUpdateCheck"];

beforeAll(async () => {
  const cli = await import("../../packages/gittensory-miner/lib/cli.js");
  const laptop =
    await import("../../packages/gittensory-miner/lib/laptop-init.js");
  const updateCheck =
    await import("../../packages/gittensory-miner/lib/update-check.js");
  ({ printHelp, printVersion, runCli } = cli);
  ({
    formatLaptopDoctor,
    initLaptopMode,
    inspectLaptopDoctor,
    resolveLaptopPaths,
  } = laptop);
  ({
    compareSemver,
    fetchLatestPackageVersion,
    maybePrintUpdateNudge,
    resolveNpmRegistryUrl,
    resolveUpgradeCommand,
    shouldSkipUpdateCheck,
    startUpdateCheck,
    awaitOpportunisticUpdateCheck,
  } = updateCheck);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeFixtureServer();
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gittensory-miner-"));
  tempRoots.push(root);
  return root;
}

async function readMinerSchemaVersion(statePath: string): Promise<string> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(statePath);
  try {
    const row = db
      .prepare("SELECT value FROM miner_state_meta WHERE key = ?")
      .get("schema_version");
    if (!row) {
      throw new Error("missing miner_state_meta schema_version row");
    }
    return row.value as string;
  } finally {
    db.close();
  }
}

describe("gittensory-miner CLI helpers", () => {
  it("prints the package version with the node runtime", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    printVersion({
      packageName: "@jsonbored/gittensory-miner",
      packageVersion: "0.1.0",
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("@jsonbored/gittensory-miner/0.1.0"),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining(process.version));
  });

  it("prints help text with the supported commands", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    printHelp({ packageName: "@jsonbored/gittensory-miner" });
    const text = log.mock.calls[0]?.[0];
    expect(text).toContain("gittensory-miner --help");
    expect(text).toContain("gittensory-miner version");
    expect(text).toContain("gittensory-miner init");
    expect(text).toContain("gittensory-miner doctor");
    expect(text).toContain("--no-update-check");
  });

  it("returns exit code 1 for unknown commands", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await expect(
      runCli(["mystery"], { packageName: "@jsonbored/gittensory-miner" }),
    ).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(
      "Unknown command: mystery. Run @jsonbored/gittensory-miner --help.",
    );
  });

  it("keeps the CLI version source aligned with package metadata", async () => {
    const packageJson = await import(
      "../../packages/gittensory-miner/package.json",
      { with: { type: "json" } }
    );
    expect(packageJson.default.version).toBe("0.1.0");
    expect(packageJson.default.engines.node).toBe(">=22.5.0");
  });
});

describe("gittensory-miner laptop mode (#2329)", () => {
  it("resolves config paths from miner env, XDG, then home fallback", async () => {
    const root = await makeTempRoot();
    const explicitConfig = join(root, "explicit");
    const xdgConfigHome = join(root, "xdg");
    const homeDir = join(root, "home");

    expect(
      resolveLaptopPaths(
        {
          GITTENSORY_MINER_CONFIG_DIR: explicitConfig,
          XDG_CONFIG_HOME: xdgConfigHome,
        },
        { homeDir },
      ),
    ).toEqual({
      configDir: explicitConfig,
      statePath: join(explicitConfig, "state.sqlite3"),
    });
    expect(resolveLaptopPaths({ XDG_CONFIG_HOME: xdgConfigHome }, { homeDir }))
      .toEqual({
        configDir: join(xdgConfigHome, "gittensory-miner"),
        statePath: join(xdgConfigHome, "gittensory-miner", "state.sqlite3"),
      });
    expect(resolveLaptopPaths({}, { homeDir })).toEqual({
      configDir: join(homeDir, ".config", "gittensory-miner"),
      statePath: join(homeDir, ".config", "gittensory-miner", "state.sqlite3"),
    });
  });

  it("creates the config directory and SQLite state database on fresh init", async () => {
    const root = await makeTempRoot();
    const configDir = join(root, "config");
    const result = await initLaptopMode({
      env: { GITTENSORY_MINER_CONFIG_DIR: configDir },
    });

    expect(result).toEqual({
      configDir,
      statePath: join(configDir, "state.sqlite3"),
      createdConfigDir: true,
      createdStateFile: true,
    });
    await expect(readFile(result.statePath)).resolves.toEqual(
      expect.objectContaining({
        length: expect.any(Number),
      }),
    );
    expect((await readFile(result.statePath)).subarray(0, 16).toString()).toBe(
      "SQLite format 3\u0000",
    );
    await expect(readMinerSchemaVersion(result.statePath)).resolves.toBe("1");
  });

  it("reruns init without clobbering existing SQLite state", async () => {
    const root = await makeTempRoot();
    const configDir = join(root, "config");
    const first = await initLaptopMode({
      env: { GITTENSORY_MINER_CONFIG_DIR: configDir },
    });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(first.statePath);
    try {
      db.exec(
        "CREATE TABLE retained_state (value TEXT NOT NULL); INSERT INTO retained_state (value) VALUES ('keep');",
      );
    } finally {
      db.close();
    }

    const second = await initLaptopMode({
      env: { GITTENSORY_MINER_CONFIG_DIR: configDir },
    });
    const verifyDb = new DatabaseSync(second.statePath);
    try {
      expect(second.createdConfigDir).toBe(false);
      expect(second.createdStateFile).toBe(false);
      const retained = verifyDb.prepare("SELECT value FROM retained_state").get();
      const schema = verifyDb
        .prepare("SELECT value FROM miner_state_meta WHERE key = ?")
        .get("schema_version");
      if (!retained || !schema) {
        throw new Error("missing retained state or schema metadata row");
      }
      expect(retained.value).toBe("keep");
      expect(schema.value).toBe("1");
    } finally {
      verifyDb.close();
    }
  });

  it("initializes an existing empty state file instead of treating it as ready", async () => {
    const root = await makeTempRoot();
    const configDir = join(root, "config");
    const statePath = join(configDir, "state.sqlite3");
    await mkdir(configDir, { recursive: true });
    await writeFile(statePath, "");

    const result = await initLaptopMode({
      env: { GITTENSORY_MINER_CONFIG_DIR: configDir },
    });

    expect(result.createdConfigDir).toBe(false);
    expect(result.createdStateFile).toBe(false);
    expect((await readFile(result.statePath)).subarray(0, 16).toString()).toBe(
      "SQLite format 3\u0000",
    );
    await expect(readMinerSchemaVersion(result.statePath)).resolves.toBe("1");
  });

  it("doctor reports absent Docker gracefully", async () => {
    const root = await makeTempRoot();
    const configDir = join(root, "config");
    await initLaptopMode({
      env: { GITTENSORY_MINER_CONFIG_DIR: configDir },
    });

    const report = await inspectLaptopDoctor({
      env: { GITTENSORY_MINER_CONFIG_DIR: configDir },
      nodeVersion: "v22.0.0",
      spawnSync: () => ({
        pid: 0,
        output: [null, "", ""],
        stdout: "",
        stderr: "",
        status: null,
        signal: null,
        error: Object.assign(new Error("spawn docker ENOENT"), {
          code: "ENOENT",
        }),
      }),
    });
    const output = formatLaptopDoctor(report);

    expect(report.nodeVersion).toBe("v22.0.0");
    expect(report.configDir).toMatchObject({
      path: configDir,
      exists: true,
      isDirectory: true,
      writable: true,
    });
    expect(report.stateFile).toMatchObject({
      path: join(configDir, "state.sqlite3"),
      exists: true,
      isFile: true,
      writable: true,
    });
    expect(report.docker).toEqual({
      present: false,
      status: "absent",
      detail: "ENOENT",
    });
    expect(output).toContain("docker: not found (ENOENT; informational only)");
  });

  it("runs laptop init and doctor through the command dispatcher", async () => {
    const root = await makeTempRoot();
    const configDir = join(root, "config");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { GITTENSORY_MINER_CONFIG_DIR: configDir };
    const spawnSyncMissingDocker = () => ({
      pid: 0,
      output: [null, "", ""],
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
      error: Object.assign(new Error("spawn docker ENOENT"), {
        code: "ENOENT",
      }),
    });

    await expect(
      runCli(["init"], {
        packageName: "@jsonbored/gittensory-miner",
        env,
      }),
    ).resolves.toBe(0);
    await expect(readMinerSchemaVersion(join(configDir, "state.sqlite3")))
      .resolves.toBe("1");

    await expect(
      runCli(["doctor"], {
        packageName: "@jsonbored/gittensory-miner",
        env,
        spawnSync: spawnSyncMissingDocker,
      }),
    ).resolves.toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain(
      "gittensory-miner laptop mode initialized.",
    );
    expect(log.mock.calls[1]?.[0]).toContain(
      "docker: not found (ENOENT; informational only)",
    );
  });
});

describe("gittensory-miner startup update check (#2331)", () => {
  it("mirrors the mcp npm registry and upgrade command conventions", () => {
    expect(resolveNpmRegistryUrl({})).toBe("https://registry.npmjs.org");
    expect(
      resolveNpmRegistryUrl({
        GITTENSORY_NPM_REGISTRY_URL: "https://registry.example.com/",
      }),
    ).toBe("https://registry.example.com");
    expect(resolveUpgradeCommand("@jsonbored/gittensory-miner")).toBe(
      "npm install -g @jsonbored/gittensory-miner@latest",
    );
  });

  it("falls back to the default npm registry for unsafe or invalid registry URLs", () => {
    expect(
      resolveNpmRegistryUrl({
        GITTENSORY_NPM_REGISTRY_URL: "file:///etc/passwd",
      }),
    ).toBe("https://registry.npmjs.org");
    expect(
      resolveNpmRegistryUrl({
        GITTENSORY_NPM_REGISTRY_URL: "http://169.254.169.254/",
      }),
    ).toBe("https://registry.npmjs.org");
    expect(
      resolveNpmRegistryUrl({
        GITTENSORY_NPM_REGISTRY_URL: "https://user:pass@registry.example.com/",
      }),
    ).toBe("https://registry.npmjs.org");
    expect(
      resolveNpmRegistryUrl({
        GITTENSORY_NPM_REGISTRY_URL: "not-a-url",
      }),
    ).toBe("https://registry.npmjs.org");
  });

  it("allows http registry URLs only on local loopback hosts", () => {
    expect(
      resolveNpmRegistryUrl({
        GITTENSORY_NPM_REGISTRY_URL: "http://127.0.0.1:4873/",
      }),
    ).toBe("http://127.0.0.1:4873");
    expect(
      resolveNpmRegistryUrl({
        GITTENSORY_NPM_REGISTRY_URL: "http://localhost:4873/",
      }),
    ).toBe("http://localhost:4873");
  });

  it("skips the check when --no-update-check or GITTENSORY_MINER_NO_UPDATE_CHECK=1 is set", () => {
    expect(shouldSkipUpdateCheck(["--version", "--no-update-check"])).toBe(
      true,
    );
    expect(
      shouldSkipUpdateCheck(["version"], {
        GITTENSORY_MINER_NO_UPDATE_CHECK: "1",
      }),
    ).toBe(true);
    expect(
      shouldSkipUpdateCheck(["version"], {
        GITTENSORY_MINER_NO_UPDATE_CHECK: "true",
      }),
    ).toBe(true);
    expect(shouldSkipUpdateCheck(["version"], {})).toBe(false);
  });

  it("orders semver values the same way as gittensory-mcp", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("0.2.0", "0.1.0")).toBe(1);
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
    expect(compareSemver("0.5.0", "0.5.0-rc.1")).toBe(1);
    expect(compareSemver("0.6.0", "0.7.0-rc.1")).toBe(-1);
  });

  it("prints a one-line upgrade nudge when npm latest is newer", async () => {
    const registryUrl = await startRegistryFixture({ latestVersion: "9.9.9" });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await maybePrintUpdateNudge({
      packageName: "@jsonbored/gittensory-miner",
      packageVersion: "0.1.0",
      npmRegistryUrl: registryUrl,
      upgradeCommand: "npm install -g @jsonbored/gittensory-miner@latest",
    });
    expect(stderr).toHaveBeenCalledWith(
      "npm install -g @jsonbored/gittensory-miner@latest\n",
    );
  });

  it("prints nothing when the installed version matches npm latest", async () => {
    const registryUrl = await startRegistryFixture({ latestVersion: "0.1.0" });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await maybePrintUpdateNudge({
      packageName: "@jsonbored/gittensory-miner",
      packageVersion: "0.1.0",
      npmRegistryUrl: registryUrl,
      upgradeCommand: "npm install -g @jsonbored/gittensory-miner@latest",
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it("swallows registry failures without throwing", async () => {
    const registryUrl = await startRegistryFixture({ npmStatus: 500 });
    await expect(
      maybePrintUpdateNudge({
        packageName: "@jsonbored/gittensory-miner",
        packageVersion: "0.1.0",
        npmRegistryUrl: registryUrl,
        upgradeCommand: "npm install -g @jsonbored/gittensory-miner@latest",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when fetchLatestPackageVersion cannot reach the registry", async () => {
    const registryUrl = await startRegistryFixture({ npmStatus: 503 });
    await expect(
      fetchLatestPackageVersion({
        packageName: "@jsonbored/gittensory-miner",
        npmRegistryUrl: registryUrl,
      }),
    ).rejects.toThrow("npm_latest_version_unavailable");
  });

  it("startUpdateCheck resolves immediately when opted out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await startUpdateCheck(["--no-update-check"], {
      packageName: "@jsonbored/gittensory-miner",
      packageVersion: "0.1.0",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("startUpdateCheck prints the nudge when npm latest is newer", async () => {
    const registryUrl = await startRegistryFixture({ latestVersion: "9.9.9" });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await startUpdateCheck(["--version"], {
      packageName: "@jsonbored/gittensory-miner",
      packageVersion: "0.1.0",
      env: { GITTENSORY_NPM_REGISTRY_URL: registryUrl },
    });
    expect(stderr).toHaveBeenCalledWith(
      "npm install -g @jsonbored/gittensory-miner@latest\n",
    );
  });

  it("startUpdateCheck stays silent when npm latest matches the installed version", async () => {
    const registryUrl = await startRegistryFixture({ latestVersion: "0.1.0" });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await startUpdateCheck(["--version"], {
      packageName: "@jsonbored/gittensory-miner",
      packageVersion: "0.1.0",
      env: { GITTENSORY_NPM_REGISTRY_URL: registryUrl },
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it("startUpdateCheck swallows registry failures without throwing", async () => {
    const registryUrl = await startRegistryFixture({ npmStatus: 500 });
    await expect(
      startUpdateCheck(["--version"], {
        packageName: "@jsonbored/gittensory-miner",
        packageVersion: "0.1.0",
        env: { GITTENSORY_NPM_REGISTRY_URL: registryUrl },
      }),
    ).resolves.toBeUndefined();
  });

  it("awaitOpportunisticUpdateCheck waits for a fast update check but caps slow lookups", async () => {
    let resolved = false;
    const fastCheck = Promise.resolve().then(() => {
      resolved = true;
    });
    await awaitOpportunisticUpdateCheck(fastCheck, 250);
    expect(resolved).toBe(true);

    const startedAt = Date.now();
    await awaitOpportunisticUpdateCheck(new Promise(() => undefined), 50);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("awaitOpportunisticUpdateCheck lets a fast update check finish before exit", async () => {
    const registryUrl = await startRegistryFixture({ latestVersion: "9.9.9" });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const updateCheck = startUpdateCheck(["mystery"], {
      packageName: "@jsonbored/gittensory-miner",
      packageVersion: "0.1.0",
      env: { GITTENSORY_NPM_REGISTRY_URL: registryUrl },
    });
    await awaitOpportunisticUpdateCheck(updateCheck);
    expect(stderr).toHaveBeenCalledWith(
      "npm install -g @jsonbored/gittensory-miner@latest\n",
    );
  });

  it("serves --version without blocking when update checks are disabled", () => {
    const output = runCapture(["--version", "--no-update-check"]);
    expect(output).toContain("@jsonbored/gittensory-miner/0.1.0");
  });

  it("serves --help immediately without waiting for a slow registry check", async () => {
    const registryUrl = await startRegistryFixture({
      latestVersion: "9.9.9",
      delayMs: 10_000,
    });
    const startedAt = Date.now();
    const output = runCapture(["--help"], {
      GITTENSORY_NPM_REGISTRY_URL: registryUrl,
    });
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(output).toContain("gittensory-miner --help");
    expect(output).not.toContain(
      "npm install -g @jsonbored/gittensory-miner@latest",
    );
  });

  it("returns unknown-command errors immediately without waiting for a slow registry check", async () => {
    const registryUrl = await startRegistryFixture({
      latestVersion: "9.9.9",
      delayMs: 10_000,
    });
    const startedAt = Date.now();
    const result = spawnSync("node", [bin, "mystery"], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITTENSORY_NPM_REGISTRY_URL: registryUrl,
      },
    });
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command: mystery");
  });
});
