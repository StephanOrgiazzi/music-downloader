const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { sanitizeFilename } = require("../text");
const { songText } = require("../genius/songs");
const { chooseYoutubeSource } = require("./matcher");

function runDownloads(entries, args) {
  const failures = [];
  for (const [index, song] of entries) {
    const text = songText(song);
    const outputBase = `${sanitizeFilename(text.artistNames)} - ${sanitizeFilename(text.title)}`;
    let source = null;

    try {
      source = chooseYoutubeSource(song, args);
    } catch (error) {
      failures.push(`[${String(index).padStart(3, "0")}] ${text.artistNames} - ${text.title}: ${error.message}`);
      continue;
    }

    if (!source) {
      failures.push(`[${String(index).padStart(3, "0")}] ${text.artistNames} - ${text.title}: no confident match`);
      continue;
    }

    const ytdlpArgs = [
      "-f", "ba",
      "-x", "--audio-format", "mp3", "--audio-quality", "0",
      "--embed-thumbnail", "--add-metadata", "--no-playlist",
      "-o", path.join(args.outputDir, `${outputBase}.%(ext)s`),
      "--no-overwrites"
    ];
    if (args.ffmpegLocation) ytdlpArgs.push("--ffmpeg-location", args.ffmpegLocation);
    if (args.cookiesFromBrowser) ytdlpArgs.push("--cookies-from-browser", args.cookiesFromBrowser);
    if (args.cookiesFile) ytdlpArgs.push("--cookies", args.cookiesFile);
    ytdlpArgs.push(source.source);

    console.log(`[${String(index).padStart(3, "0")}] ${text.artistNames} - ${text.title}`);
    console.log(`         -> ${source.label}`);
    const result = spawnSync(args.ytdlpPath, ytdlpArgs, { stdio: "inherit" });
    if (result.error || result.status !== 0) {
      failures.push(`[${String(index).padStart(3, "0")}] ${text.artistNames} - ${text.title}: yt-dlp failed`);
    }
  }
  if (failures.length) throw new Error(`Downloads completed with ${failures.length} failure(s): ${failures.join(", ")}`);
}

module.exports = { runDownloads };
