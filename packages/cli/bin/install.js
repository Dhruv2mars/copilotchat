#!/usr/bin/env node
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

import {
  assetNameFor,
  cachePathsFor,
  checksumsAssetNameFor,
  packageManagerHintFromEnv,
  parseChecksumForAsset,
  shouldInstallBinary
} from "./install-lib.js";
import { resolvePackageBinDir } from "./copilotchat-lib.js";

const REPO = "Dhruv2mars/copilotchat";
const installRoot = process.env.COPILOTCHAT_INSTALL_ROOT || join(homedir(), ".copilotchat");
const binDir = join(installRoot, "bin");
const metaPath = join(installRoot, "install-meta.json");
const binName = process.platform === "win32" ? "copilotchat.exe" : "copilotchat";
const destination = join(binDir, binName);
const version = packageVersion();
const installedVersion = readInstalledVersion(metaPath);
const here = resolvePackageBinDir(import.meta.url);
const repoRoot = join(here, "..", "..", "..");

if (process.env.COPILOTCHAT_SKIP_DOWNLOAD === "1") process.exit(0);
if (isWorkspaceInstall()) process.exit(0);
if (!shouldInstallBinary({ binExists: existsSync(destination), installedVersion, packageVersion: version })) {
  process.exit(0);
}

mkdirSync(binDir, { recursive: true });
const asset = assetNameFor();
const checksumsAsset = checksumsAssetNameFor();
const cachePaths = cachePathsFor(installRoot, version, asset, checksumsAsset);
mkdirSync(cachePaths.cacheDir, { recursive: true });
const releaseBaseUrl = process.env.COPILOTCHAT_RELEASE_BASE_URL
  || `https://github.com/${REPO}/releases/download/v${version}`;
const binaryUrl = `${releaseBaseUrl}/${asset}`;
const checksumsUrl = `${releaseBaseUrl}/${checksumsAsset}`;
const tempPath = `${destination}.tmp-${Date.now()}`;

try {
  const checksumsText = await requestText(checksumsUrl);
  await download(binaryUrl, tempPath);
  verifyChecksum(tempPath, asset, checksumsText, cachePaths.cacheDir);
  if (process.platform !== "win32") chmodSync(tempPath, 0o755);
  renameSync(tempPath, destination);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        packageManager: packageManagerHintFromEnv(process.env),
        version
      },
      null,
      2
    )
  );
} catch (errorValue) {
  try {
    rmSync(tempPath, { force: true });
  } catch {}
  console.error(`copilotchat: install failed (${String(errorValue)})`);
  process.exit(1);
}

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return pkg.version;
  } catch {
    return process.env.npm_package_version || "0.0.0";
  }
}

function readInstalledVersion(path) {
  if (!existsSync(path)) return null;
  try {
    const meta = JSON.parse(readFileSync(path, "utf8"));
    return typeof meta.version === "string" ? meta.version : null;
  } catch {
    return null;
  }
}

function download(url, outputPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("too_many_redirects"));
      return;
    }

    const request = https.get(url, { headers: { "User-Agent": "copilotchat-installer" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, outputPath, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`http ${response.statusCode}`));
        return;
      }
      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("too_many_redirects"));
      return;
    }
    const request = https.get(url, { headers: { "User-Agent": "copilotchat-installer" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        requestText(response.headers.location, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`http ${response.statusCode}`));
        return;
      }
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => resolve(data));
    });
    request.on("error", reject);
  });
}

function verifyChecksum(filePath, asset, checksumsText, cachePath) {
  const expected = parseChecksumForAsset(checksumsText, asset);
  if (!expected) {
    throw new Error("missing_checksum");
  }
  const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  if (expected !== actual) {
    throw new Error(`checksum_mismatch clear cache and retry: rm -rf ${cachePath}`);
  }
}

function isWorkspaceInstall() {
  return existsSync(join(repoRoot, "Cargo.toml")) && existsSync(join(repoRoot, "crates", "copilotchat-cli", "Cargo.toml"));
}
