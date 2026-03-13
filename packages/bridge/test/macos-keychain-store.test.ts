import { describe, expect, it } from "vitest";

import { MacOsKeychainStore, type CommandRunner } from "../src/macos-keychain-store";

describe("MacOsKeychainStore", () => {
  it("reads, writes, and deletes secrets", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = {
      run(args) {
        calls.push(args);
        if (args[0] === "add-generic-password") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: ""
          };
        }

        if (args[0] === "find-generic-password") {
          return {
            exitCode: 0,
            stderr: "",
            stdout: "secret-value\n"
          };
        }

        return {
          exitCode: 0,
          stderr: "",
          stdout: ""
        };
      }
    };
    const store = new MacOsKeychainStore({
      account: "dhruv2mars",
      runner,
      serviceName: "copilotchat.test"
    });

    await expect(store.set("bridge", "secret-value")).resolves.toBeUndefined();
    await expect(store.get("bridge")).resolves.toBe("secret-value");
    await expect(store.delete("bridge")).resolves.toBeUndefined();

    expect(calls).toEqual([
      [
        "add-generic-password",
        "-a",
        "dhruv2mars",
        "-s",
        "copilotchat.test.bridge",
        "-w",
        "secret-value",
        "-U"
      ],
      [
        "find-generic-password",
        "-a",
        "dhruv2mars",
        "-s",
        "copilotchat.test.bridge",
        "-w"
      ],
      [
        "delete-generic-password",
        "-a",
        "dhruv2mars",
        "-s",
        "copilotchat.test.bridge"
      ]
    ]);
  });

  it("returns null for missing entries and throws on command failures", async () => {
    const runner: CommandRunner = {
      run(args) {
        if (args[0] === "find-generic-password") {
          return {
            exitCode: 44,
            stderr: "The specified item could not be found in the keychain.",
            stdout: ""
          };
        }

        if (args[0] === "delete-generic-password") {
          return {
            exitCode: 55,
            stderr: "delete failed",
            stdout: ""
          };
        }

        return {
          exitCode: 99,
          stderr: "write failed",
          stdout: ""
        };
      }
    };
    const store = new MacOsKeychainStore({
      runner
    });

    await expect(store.get("bridge")).resolves.toBeNull();
    await expect(store.set("bridge", "secret-value")).rejects.toThrow("write failed");
    await expect(store.delete("bridge")).rejects.toThrow("delete failed");
  });

  it("uses the default Bun runner when none is injected", async () => {
    const originalBun = globalThis.Bun;
    globalThis.Bun = {
      spawnSync() {
        return {
          exitCode: 0,
          stderr: new TextEncoder().encode(""),
          stdout: new TextEncoder().encode("default-secret")
        };
      }
    } as unknown as typeof Bun;

    const store = new MacOsKeychainStore();
    await expect(store.get("bridge")).resolves.toBe("default-secret");

    globalThis.Bun = originalBun;
  });

  it("uses fallback error messages when stderr is empty", async () => {
    const store = new MacOsKeychainStore({
      runner: {
        run(args) {
          if (args[0] === "find-generic-password") {
            return {
              exitCode: 1,
              stderr: "",
              stdout: ""
            };
          }

          if (args[0] === "add-generic-password") {
            return {
              exitCode: 1,
              stderr: "",
              stdout: ""
            };
          }

          return {
            exitCode: 1,
            stderr: "",
            stdout: ""
          };
        }
      }
    });

    await expect(store.get("bridge")).rejects.toThrow("keychain_read_failed");
    await expect(store.set("bridge", "secret-value")).rejects.toThrow("keychain_write_failed");
    await expect(store.delete("bridge")).rejects.toThrow("keychain_delete_failed");
  });
});
