import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  binNameForPlatform,
  readInstallMeta,
  resolveInstallMetaPath,
  resolveInstallRoot,
  resolveInstalledBin,
  resolveInstalledVersion,
  resolveUpdateCommand,
  shouldRunUpdateCommand
} from "../bin/copilotchat-lib.js";

test("copilotchat lib resolves install paths and meta", () => {
  const temp = mkdtempSync(join(tmpdir(), "copilotchat-lib-"));
  try {
    const env = { COPILOTCHAT_INSTALL_ROOT: temp };
    mkdirSync(temp, { recursive: true });
    writeFileSync(resolveInstallMetaPath(env), JSON.stringify({ packageManager: "bun", version: "0.1.0" }));

    assert.equal(resolveInstallRoot(env, "/home/test"), temp);
    assert.equal(readInstallMeta(env).version, "0.1.0");
    assert.equal(resolveInstalledVersion(env), "0.1.0");
    assert.equal(resolveInstalledBin(env, "darwin", "/home/test"), join(temp, "bin", "copilotchat"));
    assert.equal(binNameForPlatform("win32"), "copilotchat.exe");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("copilotchat lib resolves update command and update arg detection", () => {
  const isolatedEnv = {
    COPILOTCHAT_INSTALL_ROOT: join(tmpdir(), "copilotchat-update-test-missing"),
    npm_config_user_agent: ""
  };
  assert.equal(shouldRunUpdateCommand(["update"]), true);
  assert.equal(shouldRunUpdateCommand(["chat"]), false);

  const npmUpdate = resolveUpdateCommand({ ...isolatedEnv, npm_execpath: "/tmp/npm-cli.js" });
  assert.equal(npmUpdate.command, process.execPath);
  assert.deepEqual(npmUpdate.args.slice(1), ["install", "-g", "@dhruv2mars/copilotchat@latest"]);

  const bunUpdate = resolveUpdateCommand({ ...isolatedEnv, npm_execpath: "/tmp/bun" });
  assert.equal(bunUpdate.command, "bun");
  assert.deepEqual(bunUpdate.args, ["add", "-g", "@dhruv2mars/copilotchat@latest"]);
});
