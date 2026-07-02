import type { SpawnSyncReturns } from "node:child_process";

export type MinerEnv = Readonly<Partial<Record<string, string | undefined>>>;

export type SpawnSyncLike = (
  command: string,
  args: readonly string[],
  options: { encoding: "utf8"; timeout: number },
) => SpawnSyncReturns<string>;

export interface LaptopPathOptions {
  homeDir?: string;
}

export interface LaptopPaths {
  configDir: string;
  statePath: string;
}

export interface LaptopInitOptions extends LaptopPathOptions {
  env?: MinerEnv;
}

export interface LaptopInitResult extends LaptopPaths {
  createdConfigDir: boolean;
  createdStateFile: boolean;
}

export interface LaptopDoctorOptions extends LaptopInitOptions {
  nodeVersion?: string;
  spawnSync?: SpawnSyncLike;
}

export interface LaptopPathReport {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  writable: boolean;
  error?: string;
}

export interface LaptopDockerReport {
  present: boolean;
  status: "present" | "absent" | "unavailable";
  detail: string;
}

export interface LaptopDoctorReport {
  nodeVersion: string;
  configDir: LaptopPathReport;
  stateFile: LaptopPathReport;
  docker: LaptopDockerReport;
}

export function resolveLaptopPaths(env?: MinerEnv, options?: LaptopPathOptions): LaptopPaths;
export function ensureLaptopStateDatabase(statePath: string): Promise<void>;
export function initLaptopMode(options?: LaptopInitOptions): Promise<LaptopInitResult>;
export function inspectLaptopDoctor(options?: LaptopDoctorOptions): Promise<LaptopDoctorReport>;
export function formatInitResult(result: LaptopInitResult): string;
export function formatLaptopDoctor(report: LaptopDoctorReport): string;

