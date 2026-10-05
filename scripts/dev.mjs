// Development: rebuild the web app on change and restart the server on change.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => spawn(process.execPath, args, { cwd: root, stdio: "inherit" });

const children = [
  run(["scripts/build-web.mjs", "--watch"]),
  run(["--import", "tsx", "--watch", "apps/server/src/main.ts"]),
];

const stop = () => {
  for (const child of children) child.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
