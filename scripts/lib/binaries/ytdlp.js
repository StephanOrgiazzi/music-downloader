const fs = require("node:fs");
const path = require("node:path");
const { RUNTIME_DIR, YTDLP_MAX_AGE_MS } = require("../config");
const { commandVersion, isStale, downloadFile } = require("./utils");

function ytdlpPath() {
  return path.join(RUNTIME_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

function ytdlpUrls() {
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
  if (process.platform === "win32") {
    if (process.arch === "arm64") return [`${base}/yt-dlp_arm64.exe`, `${base}/yt-dlp.exe`];
    if (process.arch === "ia32") return [`${base}/yt-dlp_x86.exe`, `${base}/yt-dlp.exe`];
    return [`${base}/yt-dlp.exe`];
  }
  if (process.platform === "darwin") return [`${base}/yt-dlp_macos`, `${base}/yt-dlp`];
  if (process.platform === "linux") {
    if (process.arch === "arm64") return [`${base}/yt-dlp_linux_aarch64`, `${base}/yt-dlp_musllinux_aarch64`, `${base}/yt-dlp`];
    if (process.arch === "x64") return [`${base}/yt-dlp_linux`, `${base}/yt-dlp_musllinux`, `${base}/yt-dlp`];
    return [`${base}/yt-dlp`];
  }
  return [`${base}/yt-dlp`];
}

async function ensureYtDlp() {
  const local = ytdlpPath();
  const localVersion = fs.existsSync(local) ? commandVersion(local) : null;
  const systemVersion = commandVersion("yt-dlp");

  if (localVersion && !isStale(local, YTDLP_MAX_AGE_MS)) return local;

  try {
    const candidates = ytdlpUrls();
    const failures = [];
    for (const url of candidates) {
      try {
        console.log(`${localVersion ? "Updating" : "Downloading"} yt-dlp from ${path.basename(url)}...`);
        await downloadFile(url, local);
        const downloadedVersion = commandVersion(local);
        if (!downloadedVersion) throw new Error("Downloaded yt-dlp did not run.");
        return local;
      } catch (candidateError) {
        failures.push(`${path.basename(url)}: ${candidateError.message}`);
        fs.rmSync(local, { force: true });
      }
    }
    throw new Error(failures.join("; "));
  } catch (error) {
    if (localVersion) {
      console.warn(`Could not update yt-dlp; using cached copy: ${error.message}`);
      return local;
    }
    if (systemVersion) {
      console.warn(`Could not download yt-dlp; using PATH copy: ${error.message}`);
      return "yt-dlp";
    }
    throw error;
  }
}

module.exports = { ensureYtDlp };
