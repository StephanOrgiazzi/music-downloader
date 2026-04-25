const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { RUNTIME_DIR, FFMPEG_MAX_AGE_MS } = require("../config");
const { commandVersion, isStale, findFile, extractTgz, fetchJsonSync } = require("./utils");

function ffmpegPackageName() {
  const arch = process.arch === "x64" ? "x64" : process.arch === "ia32" ? "ia32" : process.arch === "arm64" ? "arm64" : process.arch === "arm" ? "arm" : null;
  if (!arch) throw new Error(`No ffmpeg binary package mapping for architecture: ${process.arch}`);
  if (process.platform === "win32") return `@ffmpeg-installer/win32-${arch === "arm64" ? "x64" : arch}`;
  if (process.platform === "linux") return `@ffmpeg-installer/linux-${arch}`;
  if (process.platform === "darwin") return `@ffmpeg-installer/darwin-${arch}`;
  throw new Error(`No ffmpeg binary package mapping for platform: ${process.platform}`);
}

function npmPackageUrl(packageName) {
  return `https://registry.npmjs.org/${packageName.replace("/", "%2F")}/latest`;
}

function downloadFfmpeg(target) {
  const packageName = ffmpegPackageName();
  console.log(`Downloading ffmpeg (${packageName})...`);
  const meta = fetchJsonSync(npmPackageUrl(packageName));
  const tarball = meta && meta.dist && meta.dist.tarball;
  if (!tarball) throw new Error(`Could not resolve tarball for ${packageName}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-downloader-ffmpeg-"));
  const tarballPath = path.join(tempDir, "ffmpeg.tgz");
  const extractDir = path.join(tempDir, "extract");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    execFileSync(process.execPath, ["-e", `
      const fs = require("node:fs");
      fetch(process.argv[1], { headers: { "user-agent": "node" } })
        .then(async r => {
          if (!r.ok) throw new Error(String(r.status));
          fs.writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer()));
        })
        .catch(e => { console.error(e.message); process.exit(1); });
    `, tarball, tarballPath], { stdio: "inherit" });
    extractTgz(tarballPath, extractDir);

    const executable = findFile(extractDir, [process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"]);
    if (!executable) throw new Error(`Could not find ffmpeg executable in ${packageName}`);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(executable, target);
    if (process.platform !== "win32") fs.chmodSync(target, 0o755);

    const version = commandVersion(target, ["-version"]);
    if (!version) throw new Error("Downloaded ffmpeg did not run.");
    return { path: target, version, location: path.dirname(target) };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function ensureFfmpeg() {
  const local = path.join(RUNTIME_DIR, "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const localVersion = fs.existsSync(local) ? commandVersion(local, ["-version"]) : null;
  const systemVersion = commandVersion("ffmpeg", ["-version"]);

  if (localVersion && !isStale(local, FFMPEG_MAX_AGE_MS)) {
    return { path: local, version: localVersion, location: path.dirname(local) };
  }

  try {
    return downloadFfmpeg(local);
  } catch (error) {
    if (localVersion) {
      console.warn(`Could not update ffmpeg; using cached copy: ${error.message}`);
      return { path: local, version: localVersion, location: path.dirname(local) };
    }
    if (systemVersion) {
      console.warn(`Could not download ffmpeg; using PATH copy: ${error.message}`);
      return { path: "ffmpeg", version: systemVersion, location: null };
    }
    throw error;
  }
}

module.exports = { ensureFfmpeg };
