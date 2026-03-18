import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assetNameFor,
  cachePathsFor,
  checksumsAssetNameFor,
  packageManagerHintFromEnv,
  parseChecksumForAsset,
  resolvePackageVersion,
  shouldInstallBinary
} from "../bin/install-lib.js";

test("install lib resolves asset names and checksum parsing", () => {
  assert.equal(assetNameFor("darwin", "arm64"), "copilotchat-darwin-arm64");
  assert.equal(assetNameFor("win32", "x64"), "copilotchat-win32-x64.exe");
  assert.equal(checksumsAssetNameFor("linux", "arm64"), "checksums-linux-arm64.txt");

  const cache = cachePathsFor("/tmp/copilotchat", "0.1.0", "copilotchat-darwin-arm64", "checksums-darwin-arm64.txt");
  assert.equal(cache.cacheDir, "/tmp/copilotchat/cache/v0.1.0");
  assert.equal(cache.cacheBinary, "/tmp/copilotchat/cache/v0.1.0/copilotchat-darwin-arm64");

  const checksum = parseChecksumForAsset(
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *copilotchat-darwin-arm64",
    "copilotchat-darwin-arm64"
  );
  assert.equal(checksum, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("install lib detects package manager hints and install need", () => {
  assert.equal(packageManagerHintFromEnv({ npm_execpath: "/usr/local/bin/bun" }), "bun");
  assert.equal(packageManagerHintFromEnv({ npm_config_user_agent: "pnpm/10.0.0" }), "pnpm");
  assert.equal(shouldInstallBinary({ binExists: false, installedVersion: "0.1.0", packageVersion: "0.1.0" }), true);
  assert.equal(shouldInstallBinary({ binExists: true, installedVersion: "0.0.9", packageVersion: "0.1.0" }), true);
  assert.equal(shouldInstallBinary({ binExists: true, installedVersion: "0.1.0", packageVersion: "0.1.0" }), false);
});

test("install lib resolves package version from package json or env fallback", () => {
  const temp = mkdtempSync(join(tmpdir(), "copilotchat-install-lib-"));
  try {
    const packageJsonPath = join(temp, "package.json");
    writeFileSync(packageJsonPath, JSON.stringify({ version: "0.1.6" }));

    assert.equal(resolvePackageVersion(packageJsonPath, {}), "0.1.6");
    assert.equal(resolvePackageVersion(join(temp, "missing.json"), { npm_package_version: "9.9.9" }), "9.9.9");
    assert.equal(resolvePackageVersion(join(temp, "missing.json"), {}), "0.0.0");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
