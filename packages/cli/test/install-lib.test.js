import test from "node:test";
import assert from "node:assert/strict";

import {
  assetNameFor,
  cachePathsFor,
  checksumsAssetNameFor,
  packageManagerHintFromEnv,
  parseChecksumForAsset,
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
