import fs from "node:fs/promises";
import path from "node:path";

import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import { dedupeSongs, fetchSongs, filterSongs, pageviews, releaseYear, resolveArtist, selectSongs } from "./genius.js";
import { refreshYtDlpBinary, resolveFfmpegPath, resolveSkillPath } from "./runtime.js";
import { featuredArtistNames, normalizeText, primaryArtistName } from "./text.js";
import { runDownloads } from "./youtube.js";
import type { CommonArgs, ResolvedArtist, SelectedSong, Song } from "./types.js";

const MANIFEST_JSON = "manifest.json";
const MANIFEST_TXT = "manifest.txt";
type CliOption = Record<string, boolean | number | string>;

function padTrackNumber(index: number): string {
  return String(index).padStart(3, "0");
}

function resolveOutputDir(outputDir: string): string {
  return path.isAbsolute(outputDir) ? outputDir : resolveSkillPath(outputDir);
}

async function writeManifest(outDir: string, entries: SelectedSong[], artist: ResolvedArtist): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });

  const lines = entries.map(
    ([index, song]) => `${padTrackNumber(index)}. ${normalizeText(song.artist_names)} - ${normalizeText(song.title)}`
  );

  const payload = {
    artist_id: artist.artistId,
    artist_name: artist.artistName,
    songs_url: artist.songsUrl,
    selected: entries.map(([index, song]) => serializeSong(index, song))
  };

  await fs.writeFile(path.join(outDir, MANIFEST_JSON), JSON.stringify(payload, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(outDir, MANIFEST_TXT), `${lines.join("\n")}\n`, "utf8");
}

function serializeSong(index: number, song: Song) {
  return {
    index,
    id: song.id,
    artist: song.artist_names,
    primary_artist: primaryArtistName(song),
    title: song.title,
    url: song.url ?? "",
    release_year: releaseYear(song),
    pageviews: pageviews(song),
    featured_artists: featuredArtistNames(song)
  };
}

async function runJob(args: CommonArgs): Promise<void> {
  if (args.hasFeatures && args.noFeatures) {
    throw new Error("--has-features and --no-features cannot be used together.");
  }

  const outputDir = resolveOutputDir(args.outputDir);
  const artist = await resolveArtist(args.artistUrl, args.artistId);
  const songs = await fetchSongs(artist.artistId, args.maxPages);
  const filteredSongs = dedupeSongs(filterSongs(songs, args));
  const entries = selectSongs(filteredSongs, args.start, args.count);
  const jobArgs = { ...args, outputDir };

  await writeManifest(outputDir, entries, artist);

  console.log(`Artist: ${artist.artistName} (${artist.artistId})`);
  console.log(`Source: ${artist.songsUrl}`);
  console.log(`Selected: ${entries.length} tracks`);
  console.log(`Output: ${outputDir}`);

  if (!args.manifestOnly) {
    await runDownloads(entries, jobArgs);
  }
}

function commonOptions(input: Argv): Argv {
  const optionMap: Array<[name: string, config: CliOption]> = [
    ["artist-url", { type: "string" }],
    ["artist-id", { type: "number" }],
    ["output-dir", { type: "string", demandOption: true }],
    ["max-pages", { type: "number", default: 60 }],
    ["start", { type: "number", default: 1 }],
    ["count", { type: "number" }],
    ["artist-contains", { type: "array", string: true }],
    ["title-contains", { type: "array", string: true }],
    ["feature-of", { type: "array", string: true }],
    ["featured-artist", { type: "array", string: true }],
    ["exclude-featured-artist", { type: "array", string: true }],
    ["primary-artist", { type: "array", string: true }],
    ["exclude-primary-artist", { type: "array", string: true }],
    ["year", { type: "number" }],
    ["year-from", { type: "number" }],
    ["year-to", { type: "number" }],
    ["has-features", { type: "boolean", default: false }],
    ["no-features", { type: "boolean", default: false }],
    ["manifest-only", { type: "boolean", default: false }],
    ["query-template", { type: "string", default: "{artist} - {title}" }],
    ["cookies-from-browser", { type: "string" }],
    ["cookies-file", { type: "string" }]
  ];

  return optionMap.reduce((command, [name, config]) => command.option(name, config), input);
}

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName("music-downloader")
    .command("doctor", "Verify yt-dlp and ffmpeg.", (command: Argv) => command, async () => {
      console.log(`yt-dlp: ${await refreshYtDlpBinary()}`);
      console.log(`ffmpeg: ${resolveFfmpegPath()}`);
    })
    .command(
      "preview",
      "Fetch songs, filter them, and write manifests.",
      (command: Argv) => commonOptions(command),
      async (argv) => {
        await runJob({ ...(argv as unknown as CommonArgs), manifestOnly: true });
      }
    )
    .command(
      "download",
      "Fetch songs, filter them, write manifests, and download MP3 files.",
      (command: Argv) => commonOptions(command),
      async (argv) => {
        await runJob(argv as unknown as CommonArgs);
      }
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
