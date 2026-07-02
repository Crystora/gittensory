import { spawnSync as defaultSpawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR_ENV = "GITTENSORY_MINER_CONFIG_DIR";
const STATE_FILE_NAME = "state.sqlite3";

function cleanEnvPath(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function isWritable(path) {
  try {
    await access(path, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function inspectPath(path) {
  try {
    const stats = await stat(path);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      writable: await isWritable(path),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        isDirectory: false,
        isFile: false,
        writable: false,
      };
    }
    return {
      exists: false,
      isDirectory: false,
      isFile: false,
      writable: false,
      error: errorMessage(error),
    };
  }
}

export function resolveLaptopPaths(env = process.env, options = {}) {
  const home = options.homeDir ?? homedir();
  const xdgConfigHome = cleanEnvPath(env.XDG_CONFIG_HOME) ?? join(home, ".config");
  const configDir =
    cleanEnvPath(env[CONFIG_DIR_ENV]) ?? join(xdgConfigHome, "gittensory-miner");

  return {
    configDir,
    statePath: join(configDir, STATE_FILE_NAME),
  };
}

export async function ensureLaptopStateDatabase(statePath) {
  const { DatabaseSync } = await import("node:sqlite");
  let db;

  try {
    db = new DatabaseSync(statePath);
    db.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE IF NOT EXISTS miner_state_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO miner_state_meta (key, value)
      VALUES ('schema_version', '1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `);
  } catch (error) {
    throw new Error(
      `Unable to initialize SQLite state at ${statePath}: ${errorMessage(error)}`,
    );
  } finally {
    db?.close();
  }
}

export async function initLaptopMode(options = {}) {
  const paths = resolveLaptopPaths(options.env ?? process.env, {
    homeDir: options.homeDir,
  });
  const configDirExisted = await pathExists(paths.configDir);
  await mkdir(paths.configDir, { recursive: true });
  const stateFileExisted = await pathExists(paths.statePath);

  await ensureLaptopStateDatabase(paths.statePath);

  return {
    ...paths,
    createdConfigDir: !configDirExisted,
    createdStateFile: !stateFileExisted,
  };
}

function inspectDocker(spawnSync = defaultSpawnSync) {
  try {
    const result = spawnSync("docker", ["--version"], {
      encoding: "utf8",
      timeout: 2_000,
    });

    if (result.error) {
      return {
        present: false,
        status: "absent",
        detail: result.error.code ?? result.error.message,
      };
    }

    if (result.status === 0) {
      const version = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
      return {
        present: true,
        status: "present",
        detail: version || "docker command returned successfully",
      };
    }

    return {
      present: false,
      status: "unavailable",
      detail:
        `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() ||
        `docker exited with status ${result.status}`,
    };
  } catch (error) {
    return {
      present: false,
      status: "absent",
      detail: errorMessage(error),
    };
  }
}

export async function inspectLaptopDoctor(options = {}) {
  const paths = resolveLaptopPaths(options.env ?? process.env, {
    homeDir: options.homeDir,
  });
  const configDir = await inspectPath(paths.configDir);
  const stateFile = await inspectPath(paths.statePath);

  return {
    nodeVersion: options.nodeVersion ?? process.version,
    configDir: {
      path: paths.configDir,
      ...configDir,
    },
    stateFile: {
      path: paths.statePath,
      ...stateFile,
      writable: stateFile.writable && configDir.writable,
    },
    docker: inspectDocker(options.spawnSync),
  };
}

export function formatInitResult(result) {
  return [
    "gittensory-miner laptop mode initialized.",
    `config dir: ${result.configDir}`,
    `state file: ${result.statePath}`,
    `config dir status: ${result.createdConfigDir ? "created" : "already exists"}`,
    `state file status: ${result.createdStateFile ? "created" : "already exists"}`,
  ].join("\n");
}

export function formatLaptopDoctor(report) {
  const dockerStatus = report.docker.present
    ? `present (${report.docker.detail})`
    : report.docker.status === "unavailable"
      ? `unavailable (${report.docker.detail}; informational only)`
      : `not found (${report.docker.detail}; informational only)`;

  return [
    `node: ${report.nodeVersion}`,
    `config dir: ${report.configDir.path}`,
    `config dir exists: ${report.configDir.exists ? "yes" : "no"}`,
    `config dir writable: ${report.configDir.writable ? "yes" : "no"}`,
    `sqlite state: ${report.stateFile.path}`,
    `sqlite state exists: ${report.stateFile.exists ? "yes" : "no"}`,
    `sqlite state writable: ${report.stateFile.writable ? "yes" : "no"}`,
    `docker: ${dockerStatus}`,
  ].join("\n");
}
