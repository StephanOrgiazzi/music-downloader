import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptRoot = __dirname;
const skillRoot = path.resolve(scriptRoot, "..");
const tsxPath = path.join(scriptRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cliPath = path.join(scriptRoot, "src", "cli.ts");
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [tsxPath, cliPath, ...args], {
  cwd: skillRoot,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
