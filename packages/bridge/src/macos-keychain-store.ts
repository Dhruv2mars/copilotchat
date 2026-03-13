import type { SecureStore } from "./auth-session-manager";

export interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface CommandRunner {
  run(args: string[]): CommandResult;
}

export class MacOsKeychainStore implements SecureStore {
  private readonly account: string;
  private readonly runner: CommandRunner;
  private readonly serviceName: string;

  constructor(options?: {
    account?: string;
    runner?: CommandRunner;
    serviceName?: string;
  }) {
    this.account = options?.account ?? "copilotchat";
    this.runner = options?.runner ?? {
      run(args) {
        const process = Bun.spawnSync(["security", ...args], {
          stderr: "pipe",
          stdout: "pipe"
        });

        return {
          exitCode: process.exitCode,
          stderr: new TextDecoder().decode(process.stderr),
          stdout: new TextDecoder().decode(process.stdout)
        };
      }
    };
    this.serviceName = options?.serviceName ?? "copilotchat.bridge";
  }

  async get(key: string) {
    const result = this.runner.run([
      "find-generic-password",
      "-a",
      this.account,
      "-s",
      this.serviceKey(key),
      "-w"
    ]);

    if (result.exitCode !== 0) {
      if (result.stderr.includes("could not be found")) {
        return null;
      }

      throw new Error(result.stderr.trim() || "keychain_read_failed");
    }

    return result.stdout.trim();
  }

  async set(key: string, value: string) {
    const result = this.runner.run([
      "add-generic-password",
      "-a",
      this.account,
      "-s",
      this.serviceKey(key),
      "-w",
      value,
      "-U"
    ]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "keychain_write_failed");
    }
  }

  async delete(key: string) {
    const result = this.runner.run([
      "delete-generic-password",
      "-a",
      this.account,
      "-s",
      this.serviceKey(key)
    ]);

    if (result.exitCode !== 0 && !result.stderr.includes("could not be found")) {
      throw new Error(result.stderr.trim() || "keychain_delete_failed");
    }
  }

  private serviceKey(key: string) {
    return `${this.serviceName}.${key}`;
  }
}
