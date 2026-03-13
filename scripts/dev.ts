import { spawn, type ChildProcess } from "node:child_process";

type ProcSpec = {
  args: string[];
  label: string;
};

const bunCmd = process.platform === "win32" ? "bun.cmd" : "bun";

const procs: ProcSpec[] = [
  {
    args: ["run", "--filter", "@copilotchat/bridge", "dev"],
    label: "bridge"
  },
  {
    args: ["run", "--filter", "@copilotchat/web", "dev"],
    label: "web"
  }
];

const children = new Map<string, ChildProcess>();
let shuttingDown = false;

for (const proc of procs) {
  const child = spawn(bunCmd, proc.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  children.set(proc.label, child);

  child.on("exit", (code, signal) => {
    children.delete(proc.label);

    if (shuttingDown) {
      if (children.size === 0) {
        process.exit(code ?? 0);
      }
      return;
    }

    shuttingDown = true;
    stopOthers(proc.label);

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
  stopOthers();

  if (children.size === 0) {
    process.exit(0);
  }

  setTimeout(() => {
    for (const child of children.values()) {
      child.kill("SIGKILL");
    }
  }, 1_000).unref();

  for (const child of children.values()) {
    child.kill(signal);
  }
}

function stopOthers(skipLabel?: string) {
  for (const [label, child] of children.entries()) {
    if (label === skipLabel) {
      continue;
    }
    child.kill("SIGTERM");
  }
}
