const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync, execFileSync } = require("node:child_process");
const { GENIUS_HEADERS } = require("../config");

function commandVersion(command, versionArgs = ["--version"]) {
  const result = spawnSync(command, versionArgs, { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr || "").split(/\r?\n/).find(Boolean) || "available";
}

function isStale(file, maxAgeMs) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs > maxAgeMs;
  } catch (_) {
    return true;
  }
}

async function downloadFile(url, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const response = await fetch(url, { headers: { "user-agent": GENIUS_HEADERS["user-agent"] } });
  if (!response.ok) throw new Error(`Download failed for ${url}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, buffer);
  fs.renameSync(tempFile, file);
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
}

function findFile(dir, names) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, names);
      if (found) return found;
    } else if (names.includes(entry.name)) {
      return fullPath;
    }
  }
  return null;
}

function safeExtractPath(root, name) {
  const target = path.resolve(root, name);
  if (!target.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`Refusing to extract outside target directory: ${name}`);
  }
  return target;
}

function extractTgz(tarballPath, outputDir) {
  const tar = zlib.gunzipSync(fs.readFileSync(tarballPath));
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const type = header.subarray(156, 157).toString("utf8") || "0";
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const body = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (!name) continue;
    const target = safeExtractPath(outputDir, name);
    if (type === "5") {
      fs.mkdirSync(target, { recursive: true });
    } else if (type === "0" || type === "") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
  }
}

function fetchJsonSync(url) {
  const child = spawnSync(process.execPath, ["-e", `
    fetch(process.argv[1], { headers: { "user-agent": "node" } })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        process.stdout.write(await r.text());
      })
      .catch(e => { console.error(e.message); process.exit(1); });
  `, url], { encoding: "utf8" });
  if (child.error || child.status !== 0) throw new Error(`Request failed for ${url}: ${child.stderr || child.error.message}`);
  return JSON.parse(child.stdout);
}

module.exports = {
  commandVersion,
  isStale,
  downloadFile,
  findFile,
  extractTgz,
  fetchJsonSync
};
