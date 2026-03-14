import { spawn } from "node:child_process";

const bunCmd = process.platform === "win32" ? "bun.cmd" : "bun";
const port = process.env.PORT?.trim() || "4173";

const child = spawn(bunCmd, ["x", "vercel", "dev", "--listen", port], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

let shuttingDown = false;

child.on("exit", (code, signal) => {
  if (shuttingDown) {
    process.exit(code ?? 0);
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  child.kill(signal);

  setTimeout(() => {
    child.kill("SIGKILL");
  }, 1_000).unref();
}
