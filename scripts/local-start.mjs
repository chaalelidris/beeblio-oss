import { missingProductionBuilds, startLocalServers } from "./local-servers.mjs";

const builds = missingProductionBuilds(process.cwd());
if (builds.length) {
  console.error(`Production builds are missing. Run:\n  ${builds.join("\n  ")}`);
  process.exit(1);
}

let servers;
servers = await startLocalServers({
  root: process.cwd(),
  mode: "start",
  onExit(_name, code, error) {
    if (error) console.error(error);
    else console.error(`Local server exited (${code})`);
    process.exitCode = typeof code === "number" && code !== 0 ? code : 1;
    void servers?.stop();
  },
});
for (const warning of servers.warnings) console.warn(warning);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void servers.stop());
