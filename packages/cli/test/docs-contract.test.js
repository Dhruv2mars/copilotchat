import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = join(testDir, "..");
const repoRoot = join(packageRoot, "..", "..");

function read(path) {
  return readFileSync(path, "utf8");
}

test("repo ships core oss docs and templates", () => {
  const requiredFiles = [
    "README.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "LICENSE",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    "packages/cli/README.md",
    "packages/cli/CHANGELOG.md"
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(
      existsSync(join(repoRoot, relativePath)),
      true,
      `${relativePath} should exist`
    );
  }
});

test("root readme documents supported install and update paths", () => {
  const readme = read(join(repoRoot, "README.md"));
  assert.match(readme, /npm i -g @dhruv2mars\/copilotchat/);
  assert.match(readme, /bun install -g @dhruv2mars\/copilotchat/);
  assert.match(readme, /copilotchat update/);
  assert.match(readme, /First run downloads the native binary/i);
});

test("package readme is npm-ready and package avoids blocked postinstall", () => {
  const packageReadme = read(join(packageRoot, "README.md"));
  assert.match(packageReadme, /@dhruv2mars\/copilotchat/);
  assert.match(packageReadme, /bun install -g @dhruv2mars\/copilotchat/);
  assert.match(packageReadme, /copilotchat update/);

  const pkg = JSON.parse(read(join(packageRoot, "package.json")));
  assert.equal("postinstall" in pkg.scripts, false);
});
