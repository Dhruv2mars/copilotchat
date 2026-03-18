import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { assetNameFor, checksumsAssetNameFor } from "../bin/install-lib.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = join(testDir, "..");
const repoRoot = join(packageRoot, "..", "..");
const releaseWorkflow = join(repoRoot, ".github", "workflows", "release.yml");

function parseReleaseAssets(workflowText) {
  const includeBlocks = workflowText.match(/-\s+os:[\s\S]*?(?=\n\s*-\s+os:|\n\s*runs-on:|\n\s*steps:)/g) || [];
  const assets = [];
  for (const block of includeBlocks) {
    const platform = block.match(/platform:\s*"?([a-z0-9]+)"?/i)?.[1];
    const arch = block.match(/arch:\s*"?([a-z0-9_]+)"?/i)?.[1];
    const ext = block.match(/ext:\s*"([^"]*)"|ext:\s*'([^']*)'/)?.slice(1).find(Boolean) ?? "";
    if (!platform || !arch) continue;
    assets.push({ platform, arch, ext, name: `copilotchat-${platform}-${arch}${ext}` });
  }
  return assets;
}

test("release workflow declares expected installer asset matrix", () => {
  const assets = parseReleaseAssets(readFileSync(releaseWorkflow, "utf8"));
  const names = new Set(assets.map((item) => item.name));

  assert.deepEqual(
    names,
    new Set([
      "copilotchat-linux-x64",
      "copilotchat-linux-arm64",
      "copilotchat-win32-x64.exe",
      "copilotchat-win32-arm64.exe",
      "copilotchat-darwin-arm64",
      "copilotchat-darwin-x64"
    ])
  );
});

test("installer asset naming agrees with release matrix", () => {
  const assets = parseReleaseAssets(readFileSync(releaseWorkflow, "utf8"));
  for (const asset of assets) {
    assert.equal(assetNameFor(asset.platform, asset.arch), asset.name);
    assert.equal(
      checksumsAssetNameFor(asset.platform, asset.arch),
      `checksums-${asset.platform}-${asset.arch}.txt`
    );
  }
});

test("release workflow keeps tag and npm publish contract", () => {
  const text = readFileSync(releaseWorkflow, "utf8");
  assert.match(text, /tags:\s*\n\s*-\s*["']v\*["']/);
  assert.match(text, /gh release create "\$\{RELEASE_TAG\}" --title "\$\{RELEASE_TAG\}" --generate-notes/);
  assert.match(text, /npm publish --provenance --access public/);
});
