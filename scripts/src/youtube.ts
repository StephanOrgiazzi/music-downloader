import path from "node:path";

import { execa } from "execa";

import { refreshYtDlpBinary, resolveFfmpegPath } from "./runtime.js";
import { normalizeText, primaryArtistName, sanitizeFilename, significantWords, songText } from "./text.js";
import { releaseYear } from "./genius.js";
import type { CommonArgs, DownloadSource, SearchCandidate, SelectedSong, Song } from "./types.js";

type Json = Record<string, unknown>;

const DEFAULT_SEARCH_RESULTS = 8;
const MIN_MATCH_SCORE = 25;
const POSITIVE_HINTS = ["official audio", "provided to youtube", "topic"] as const;
const NEGATIVE_HINTS = ["music video", "lyric video", "lyrics video", "live", "karaoke", "reaction", "cover"] as const;

async function ytDlpJson(binaryPath: string, args: string[]): Promise<Json> {
  const { stdout } = await execa(binaryPath, args);
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) {
    throw new Error("yt-dlp returned no JSON payload.");
  }
  return JSON.parse(line) as Json;
}

function countMatches(words: string[], text: string): number {
  return words.filter((word) => text.includes(word)).length;
}

function buildQuery(song: Song, template: string): string {
  return template
    .replaceAll("{artist}", normalizeText(song.artist_names))
    .replaceAll("{primary_artist}", primaryArtistName(song))
    .replaceAll("{title}", normalizeText(song.title))
    .replaceAll("{year}", releaseYear(song)?.toString() ?? "")
    .replaceAll("{index}", "");
}

function parseCandidate(entry: Json): SearchCandidate {
  return {
    id: String(entry.id ?? ""),
    url: String(entry.url ?? ""),
    title: normalizeText(String(entry.title ?? "")),
    channel: normalizeText(String(entry.channel ?? "")),
    uploader: normalizeText(String(entry.uploader ?? "")),
    description: normalizeText(String(entry.description ?? "")),
    viewCount: typeof entry.view_count === "number" ? entry.view_count : null,
    channelIsVerified: Boolean(entry.channel_is_verified)
  };
}

function scoreCandidate(song: Song, candidate: SearchCandidate): number {
  const titleWords = significantWords(song.title);
  const primaryWords = significantWords(primaryArtistName(song));
  const artistWords = significantWords(song.artist_names);
  const titleText = normalizeText(candidate.title).toLowerCase();
  const bodyText = [candidate.title, candidate.channel, candidate.uploader, candidate.description].join(" ").toLowerCase();

  const titleMatches = countMatches(titleWords, titleText);
  const primaryMatches = countMatches(primaryWords, bodyText);
  const artistMatches = countMatches(artistWords, bodyText);

  let score = titleMatches * 25 + primaryMatches * 12 + artistMatches * 6;
  if (titleWords.length > 0 && titleMatches < Math.max(1, titleWords.length - 1)) score -= 100;
  if (primaryWords.length > 0 && primaryMatches === 0) score -= 40;
  if (candidate.channelIsVerified) score += 10;
  if (POSITIVE_HINTS.some((hint) => bodyText.includes(hint))) score += 18;
  for (const penalty of NEGATIVE_HINTS) {
    if (bodyText.includes(penalty)) score -= 35;
  }
  if (candidate.viewCount) score += Math.min(10, Math.floor(Math.log10(Math.max(candidate.viewCount, 1))));

  return score;
}

async function chooseYoutubeSource(
  binaryPath: string,
  song: Song,
  queryTemplate: string,
  searchResults: number,
  cookiesFromBrowser?: string,
  cookiesFile?: string
): Promise<DownloadSource | null> {
  const args = ["-J"];
  if (cookiesFromBrowser) args.push("--cookies-from-browser", cookiesFromBrowser);
  if (cookiesFile) args.push("--cookies", cookiesFile);
  args.push(`ytsearch${Math.max(1, searchResults)}:${buildQuery(song, queryTemplate)}`);

  const payload = await ytDlpJson(binaryPath, args);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const candidates = entries
    .filter((entry): entry is Json => typeof entry === "object" && entry !== null)
    .map(parseCandidate)
    .map((candidate) => ({ candidate, score: scoreCandidate(song, candidate) }))
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best || best.score < MIN_MATCH_SCORE) {
    return null;
  }

  return {
    source: best.candidate.url || `https://www.youtube.com/watch?v=${best.candidate.id}`,
    label: `${best.candidate.channel || best.candidate.uploader} | ${best.candidate.title}`
  };
}

export async function runDownloads(entries: SelectedSong[], args: CommonArgs): Promise<void> {
  const binaryPath = await refreshYtDlpBinary();
  const ffmpegLocation = resolveFfmpegPath();
  const failures: string[] = [];

  for (const [index, song] of entries) {
    const { artistNames: artist, title } = songText(song);
    const outputBase = `${sanitizeFilename(artist)} - ${sanitizeFilename(title)}`;

    let source: DownloadSource | null;
    try {
      source = await chooseYoutubeSource(
        binaryPath,
        song,
        args.queryTemplate,
        DEFAULT_SEARCH_RESULTS,
        args.cookiesFromBrowser,
        args.cookiesFile
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`[${String(index).padStart(3, "0")}] ${artist} - ${title}: ${message}`);
      continue;
    }

    if (!source) {
      failures.push(`[${String(index).padStart(3, "0")}] ${artist} - ${title}: no confident match`);
      continue;
    }

    const ytArgs = [
      "-f",
      "ba",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--embed-thumbnail",
      "--add-metadata",
      "--no-playlist",
      "--ffmpeg-location",
      ffmpegLocation,
      "-o",
      path.join(args.outputDir, `${outputBase}.%(ext)s`),
      "--no-overwrites"
    ];

    if (args.cookiesFromBrowser) ytArgs.push("--cookies-from-browser", args.cookiesFromBrowser);
    if (args.cookiesFile) ytArgs.push("--cookies", args.cookiesFile);
    ytArgs.push(source.source);

    console.log(`[${String(index).padStart(3, "0")}] ${artist} - ${title}`);
    console.log(`         -> ${source.label}`);

    try {
      await execa(binaryPath, ytArgs, { stdio: "inherit" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`[${String(index).padStart(3, "0")}] ${artist} - ${title}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Downloads completed with ${failures.length} failure(s): ${failures.join(", ")}`);
  }
}
