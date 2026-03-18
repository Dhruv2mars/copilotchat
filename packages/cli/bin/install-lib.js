import { readFileSync } from "node:fs";
import { join } from "node:path";

export function assetNameFor(platform = process.platform, arch = process.arch) {
  const ext = platform === "win32" ? ".exe" : "";
  return `copilotchat-${platform}-${arch}${ext}`;
}

export function checksumsAssetNameFor(platform = process.platform, arch = process.arch) {
  return `checksums-${platform}-${arch}.txt`;
}

export function cachePathsFor(installRoot, version, asset, checksumsAsset) {
  const root = join(installRoot, "cache", `v${version}`);
  return {
    cacheBinary: join(root, asset),
    cacheChecksums: join(root, checksumsAsset),
    cacheDir: root
  };
}

export function packageManagerHintFromEnv(env = process.env) {
  const execPath = String(env.npm_execpath || "").toLowerCase();
  if (execPath.includes("bun")) return "bun";
  if (execPath.includes("pnpm")) return "pnpm";
  if (execPath.includes("yarn")) return "yarn";
  if (execPath.includes("npm")) return "npm";

  const ua = String(env.npm_config_user_agent || "").toLowerCase();
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("yarn/")) return "yarn";
  if (ua.startsWith("npm/")) return "npm";

  return null;
}

export function parseChecksumForAsset(text, asset) {
  if (typeof text !== "string") return null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) continue;
    if (match[2].trim() !== asset) continue;
    return match[1].toLowerCase();
  }
  return null;
}

export function shouldInstallBinary({ binExists, installedVersion, packageVersion }) {
  if (!binExists) return true;
  if (!packageVersion) return false;
  return installedVersion !== packageVersion;
}

export function resolvePackageVersion(packageJsonPath, env = process.env) {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return typeof pkg.version === "string" && pkg.version.length > 0
      ? pkg.version
      : (env.npm_package_version || "0.0.0");
  } catch {
    return env.npm_package_version || "0.0.0";
  }
}
