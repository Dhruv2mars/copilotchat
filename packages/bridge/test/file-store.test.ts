import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStore } from "../src/file-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("FileStore", () => {
  it("returns null for a missing session file", async () => {
    const path = await makePath();
    const store = new FileStore(path);

    await expect(store.get("ignored")).resolves.toBeNull();
  });

  it("persists and clears the session file", async () => {
    const path = await makePath();
    const store = new FileStore(path);

    await store.set("ignored", "secret");
    await expect(store.get("ignored")).resolves.toBe("secret");

    await store.delete("ignored");
    await expect(store.get("ignored")).resolves.toBeNull();
  });

  it("locks the session file permissions on unix", async () => {
    if (process.platform === "win32") {
      return;
    }

    const path = await makePath();
    const store = new FileStore(path);

    await store.set("ignored", "secret");

    const metadata = await stat(path);
    expect(metadata.mode & 0o777).toBe(0o600);

    await chmod(path, 0o644);
    await store.set("ignored", "secret-2");

    const updated = await stat(path);
    expect(updated.mode & 0o777).toBe(0o600);
  });

  it("rethrows unexpected read errors", async () => {
    const path = await makePath();
    const store = new FileStore(path, {
      readFile: async () => {
        throw new Error("permission_denied");
      }
    });

    await expect(store.get("ignored")).rejects.toThrow("permission_denied");
  });

  it("skips chmod on win32", async () => {
    const path = await makePath();
    let chmodCalls = 0;
    const store = new FileStore(path, {
      chmod: async () => {
        chmodCalls += 1;
      },
      platform: "win32"
    });

    await store.set("ignored", "secret");

    expect(chmodCalls).toBe(0);
    await expect(store.get("ignored")).resolves.toBe("secret");
  });
});

async function makePath() {
  const root = await mkdtemp(join(tmpdir(), "copilotchat-bridge-"));
  tempRoots.push(root);
  return join(root, "session.json");
}
