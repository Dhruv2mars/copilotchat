import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { SecureStore } from "./auth-session-manager";

interface FileStoreOptions {
  chmod?: typeof chmod;
  mkdir?: typeof mkdir;
  platform?: NodeJS.Platform;
  readFile?: typeof readFile;
  rm?: typeof rm;
  writeFile?: typeof writeFile;
}

export class FileStore implements SecureStore {
  private readonly chmodFile: typeof chmod;
  private readonly mkdirDir: typeof mkdir;
  private readonly platform: NodeJS.Platform;
  private readonly readSession: typeof readFile;
  private readonly removeFile: typeof rm;
  private readonly writeSession: typeof writeFile;

  constructor(
    private readonly path: string,
    options: FileStoreOptions = {}
  ) {
    this.chmodFile = options.chmod ?? chmod;
    this.mkdirDir = options.mkdir ?? mkdir;
    this.platform = options.platform ?? process.platform;
    this.readSession = options.readFile ?? readFile;
    this.removeFile = options.rm ?? rm;
    this.writeSession = options.writeFile ?? writeFile;
  }

  async get(_key: string) {
    try {
      return await this.readSession(this.path, "utf8");
    } catch (errorValue) {
      if (isMissing(errorValue)) {
        return null;
      }

      throw errorValue;
    }
  }

  async set(_key: string, value: string) {
    await this.mkdirDir(dirname(this.path), { recursive: true });
    await this.writeSession(this.path, value, "utf8");
    if (this.platform !== "win32") {
      await this.chmodFile(this.path, 0o600);
    }
  }

  async delete(_key: string) {
    await this.removeFile(this.path, { force: true });
  }
}

function isMissing(errorValue: unknown) {
  return (
    typeof errorValue === "object" &&
    errorValue !== null &&
    "code" in errorValue &&
    errorValue.code === "ENOENT"
  );
}
