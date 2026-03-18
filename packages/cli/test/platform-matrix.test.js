import test from "node:test";
import assert from "node:assert/strict";

import { assetNameFor, checksumsAssetNameFor } from "../bin/install-lib.js";
import { binNameForPlatform } from "../bin/copilotchat-lib.js";

test("platform matrix naming stays valid for all shipped targets", () => {
  const cases = [
    { platform: "linux", arch: "x64", bin: "copilotchat", asset: "copilotchat-linux-x64" },
    { platform: "linux", arch: "arm64", bin: "copilotchat", asset: "copilotchat-linux-arm64" },
    { platform: "darwin", arch: "arm64", bin: "copilotchat", asset: "copilotchat-darwin-arm64" },
    { platform: "darwin", arch: "x64", bin: "copilotchat", asset: "copilotchat-darwin-x64" },
    { platform: "win32", arch: "x64", bin: "copilotchat.exe", asset: "copilotchat-win32-x64.exe" },
    { platform: "win32", arch: "arm64", bin: "copilotchat.exe", asset: "copilotchat-win32-arm64.exe" }
  ];

  for (const item of cases) {
    assert.equal(binNameForPlatform(item.platform), item.bin);
    assert.equal(assetNameFor(item.platform, item.arch), item.asset);
    assert.equal(
      checksumsAssetNameFor(item.platform, item.arch),
      `checksums-${item.platform}-${item.arch}.txt`
    );
  }
});
