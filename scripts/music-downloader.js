#!/usr/bin/env node
const path = require("node:path");
const { usage, parseArgs } = require("./lib/cli");
const { resolveArtist } = require("./lib/genius/artist");
const { collectSongs, selectedSongs, writeManifest } = require("./lib/genius/songs");
const { ensureYtDlp } = require("./lib/binaries/ytdlp");
const { ensureFfmpeg } = require("./lib/binaries/ffmpeg");
const { runDownloads } = require("./lib/youtube/downloader");

async function doctor() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  console.log(`node: ${process.version}`);
  if (nodeMajor < 18) throw new Error("Node.js 18+ is required for built-in fetch.");

  const ytdlp = await ensureYtDlp();
  const ffmpeg = ensureFfmpeg();
  const { commandVersion } = require("./lib/binaries/utils");
  console.log(`yt-dlp: ${commandVersion(ytdlp)} (${ytdlp})`);
  console.log(`ffmpeg: ${ffmpeg.version} (${ffmpeg.path})`);
}

async function runJob(args) {
  if (!args.outputDir) throw new Error("Provide --output-dir.");
  if (args.hasFeatures && args.noFeatures) throw new Error("--has-features and --no-features cannot be used together.");
  const outputDir = path.resolve(process.cwd(), args.outputDir);
  const artist = await resolveArtist(args);
  console.log(`Artist: ${artist.artistName} (${artist.artistId})`);
  console.log(`Source: ${artist.songsUrl}`);

  const songs = await collectSongs(artist.artistId, args);
  const entries = selectedSongs(songs, args.start, args.count);
  const ytdlp = args.manifestOnly ? null : await ensureYtDlp();
  const ffmpeg = args.manifestOnly ? null : ensureFfmpeg();
  const jobArgs = { ...args, outputDir, ytdlpPath: ytdlp, ffmpegLocation: ffmpeg && ffmpeg.location };
  writeManifest(outputDir, entries, artist);
  console.log(`Selected: ${entries.length} tracks`);
  console.log(`Output: ${outputDir}`);

  if (!args.manifestOnly) runDownloads(entries, jobArgs);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.command || args.command === "help" || args.command === "--help") {
    usage();
    return;
  }
  if (args.command === "doctor") {
    await doctor();
    return;
  }
  if (args.command === "preview") args.manifestOnly = true;
  if (!["preview", "download"].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  await runJob(args);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
