import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { startLocalServers } from "./local-servers.mjs";

const root = process.cwd();
const eveStateFile = path.join(root, ".eve", "dev-server-state.v1.json");
if (existsSync(eveStateFile)) {
  try {
    unlinkSync(eveStateFile);
  } catch {}
}

let servers;
servers = await startLocalServers({
  root,
  onExit(_name, code, error) {
    if (error) console.error(error);
    else console.error(`Local server exited (${code})`);
    process.exitCode = typeof code === "number" && code !== 0 ? code : 1;
    void servers?.stop();
  },
});
for (const warning of servers.warnings) console.warn(warning);
// SIGHUP too: the servers run in their own process groups, so a closed terminal no longer reaches them directly.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void servers.stop());
