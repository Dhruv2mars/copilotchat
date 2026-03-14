import { spawn, type ChildProcess } from "node:child_process";

const bunCmd = process.platform === "win32" ? "bun.cmd" : "bun";
const children = [
  startProcess(["run", "dev:bridge"]),
  startProcess(["run", "dev:web"])
];

let shuttingDown = false;

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const otherChild of children) {
      if (otherChild.pid !== child.pid) {
        otherChild.kill("SIGTERM");
      }
    }

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    child.kill(signal);
  }

  setTimeout(() => {
    for (const child of children) {
      child.kill("SIGKILL");
    }
  }, 1_000).unref();
}

function startProcess(args: string[]) {
  return spawn(bunCmd, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
}
