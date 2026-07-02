import {
  formatInitResult,
  formatLaptopDoctor,
  initLaptopMode,
  inspectLaptopDoctor,
} from "./laptop-init.js";

function formatCliError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function printVersion(input) {
  console.log(`${input.packageName}/${input.packageVersion} (node ${process.version})`);
}

export function printHelp(input) {
  console.log(
    [
      input.packageName,
      "",
      "Foundation CLI for the local Gittensory miner runtime.",
      "",
      "Usage:",
      "  gittensory-miner --help",
      "  gittensory-miner --version",
      "  gittensory-miner help",
      "  gittensory-miner version",
      "  gittensory-miner init",
      "  gittensory-miner doctor",
      "",
      "Options:",
      "  --no-update-check  Skip the npm registry version nudge (also GITTENSORY_MINER_NO_UPDATE_CHECK=1)",
    ].join("\n"),
  );
}

export async function runCli(cliArgs, input) {
  const command = cliArgs[0] ?? "";

  if (command === "init") {
    try {
      const result = await initLaptopMode({
        env: input.env,
        homeDir: input.homeDir,
      });
      console.log(formatInitResult(result));
      return 0;
    } catch (error) {
      console.error(`init failed: ${formatCliError(error)}`);
      return 1;
    }
  }

  if (command === "doctor") {
    const report = await inspectLaptopDoctor({
      env: input.env,
      homeDir: input.homeDir,
      nodeVersion: input.nodeVersion,
      spawnSync: input.spawnSync,
    });
    console.log(formatLaptopDoctor(report));
    return 0;
  }

  console.error(`Unknown command: ${command}. Run ${input.packageName} --help.`);
  return 1;
}
