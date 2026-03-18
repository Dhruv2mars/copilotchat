#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  resolvePackageBinDir,
  resolveInstalledBin,
  resolveInstalledVersion,
  resolveUpdateCommand,
  shouldInstallBinary,
  shouldRunUpdateCommand
} from "./copilotchat-lib.js";

const args = process.argv.slice(2);

if (shouldRunUpdateCommand(args)) {
  const update = resolveUpdateCommand(process.env);
  const result = spawnSync(update.command, update.args, { stdio: "inherit", env: process.env });
  process.exit(result.status ?? 1);
}

if (process.env.COPILOTCHAT_BIN) {
  run(process.env.COPILOTCHAT_BIN, args);
}

const installedBin = resolveInstalledBin(process.env, process.platform);
const packageVersion = readPackageVersion();
const installedVersion = resolveInstalledVersion(process.env);

if (
  shouldInstallBinary({
    binExists: existsSync(installedBin),
    installedVersion,
    packageVersion
  })
) {
  console.error("copilotchat: setting up native binary...");
  const here = resolvePackageBinDir(import.meta.url);
  const installer = join(here, "install.js");
  const install = spawnSync(process.execPath, [installer], { stdio: "inherit", env: process.env });
  if (install.status !== 0 || !existsSync(installedBin)) {
    console.error("copilotchat: install missing. try reinstall: npm i -g @dhruv2mars/copilotchat");
    process.exit(1);
  }
}

run(installedBin, args);

function run(bin, binArgs) {
  const result = spawnSync(bin, binArgs, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function readPackageVersion() {
  try {
    const here = resolvePackageBinDir(import.meta.url);
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return pkg.version;
  } catch {
    return "";
  }
}
