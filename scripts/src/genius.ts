import * as cheerio from "cheerio";
import { fetch } from "undici";
import { z } from "zod";

import { featuredArtistNames, includesAny, includesNone, normalizeText, primaryArtistName, songText, titleFromSlug } from "./text.js";
import type { CommonArgs, ResolvedArtist, SelectedSong, Song } from "./types.js";

const GENIUS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36";
const GENIUS_HEADERS = { "user-agent": GENIUS_USER_AGENT };
const GENIUS_API_HEADERS = { ...GENIUS_HEADERS, "x-requested-with": "XMLHttpRequest" };
const ARTIST_ID_PATTERNS = [
  /"artistDiscography":\{"[^"]*".*?"artist":(\d+)/,
  /rawData\s*=\s*JSON\.parse\('\{\\?"artist_id\\?":(\d+)/,
  /\\"artist_id\\":(\d+),\\"artist_in_top_10\\"/,
  /"artist_id":(\d+)/
] as const;

const songsResponseSchema = z.object({
  response: z.object({
    songs: z.array(z.record(z.string(), z.unknown()))
  })
});

function lowerNames(values: string[]): string[] {
  return values.map((value) => normalizeText(value).toLowerCase());
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: GENIUS_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.text();
}

export async function resolveArtist(artistUrl?: string, artistId?: number): Promise<ResolvedArtist> {
  if (artistId !== undefined) {
    const slug = artistUrl?.replace(/\/songs\/?$/, "").split("/").at(-1) ?? `artist-${artistId}`;
    return {
      artistId,
      artistName: titleFromSlug(slug),
      songsUrl: artistUrl ?? `https://genius.com/artists/${artistId}/songs`
    };
  }

  if (!artistUrl) {
    throw new Error("Provide --artist-url or --artist-id.");
  }

  const html = await fetchText(artistUrl);
  const match = ARTIST_ID_PATTERNS.map((pattern) => html.match(pattern)).find((result) => result?.[1]);
  if (!match?.[1]) {
    throw new Error("Could not resolve artist id from Genius page.");
  }

  const $ = cheerio.load(html);
  const title = $("title").text().replace(/\s+/g, " ").trim().replace(/\s+Songs$/, "");
  const songsUrl = html.match(/"songsUrl":"([^"]+)"/)?.[1]?.replaceAll("\\/", "/") ?? artistUrl;

  return {
    artistId: Number.parseInt(match[1], 10),
    artistName: title || "Unknown Artist",
    songsUrl
  };
}

export async function fetchSongs(artistId: number, maxPages: number): Promise<Song[]> {
  const songs: Song[] = [];
  const seen = new Set<number>();

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetch(`https://genius.com/api/artists/${artistId}/songs?page=${page}&sort=popularity`, {
      headers: GENIUS_API_HEADERS
    });

    if (!response.ok) {
      throw new Error(`Genius songs API failed on page ${page}: ${response.status}`);
    }

    const payload = songsResponseSchema.parse(await response.json()).response.songs as unknown as Song[];
    if (payload.length === 0) {
      break;
    }

    let added = 0;
    for (const song of payload) {
      if (seen.has(song.id)) {
        continue;
      }
      seen.add(song.id);
      songs.push(song);
      added += 1;
    }

    if (added === 0) {
      break;
    }
  }

  return songs;
}

export function releaseYear(song: Song): number | null {
  const rawYear = song.release_date_components?.year;
  if (typeof rawYear === "number") {
    return rawYear;
  }
  if (typeof rawYear === "string" && /^\d{4}$/.test(rawYear)) {
    return Number.parseInt(rawYear, 10);
  }
  const fallback = song.release_date_for_display ?? song.release_date_with_abbreviated_month_for_display ?? "";
  const match = fallback.match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

export function pageviews(song: Song): number | null {
  const raw = song.stats?.pageviews;
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return null;
}

function hasFeatures(song: Song): boolean {
  if (featuredArtistNames(song).length > 0) {
    return true;
  }
  const artistNames = normalizeText(song.artist_names).toLowerCase();
  return artistNames.includes("(ft.") || artistNames.includes("(feat.") || artistNames.includes(" featuring ");
}

function isFeatureOf(song: Song, names?: string[]): boolean {
  if (!names || names.length === 0) {
    return true;
  }
  const primary = primaryArtistName(song).toLowerCase();
  const featured = lowerNames(featuredArtistNames(song));
  const artistLine = normalizeText(song.artist_names).toLowerCase();
  return lowerNames(names).every((normalized) => {
    return featured.includes(normalized) || (artistLine.includes(normalized) && !primary.includes(normalized));
  });
}

function hasFeaturedArtists(song: Song, names?: string[]): boolean {
  if (!names || names.length === 0) {
    return true;
  }
  const featured = lowerNames(featuredArtistNames(song));
  return lowerNames(names).every((name) => featured.includes(name));
}

function hasNoFeaturedArtists(song: Song, names?: string[]): boolean {
  if (!names || names.length === 0) {
    return true;
  }
  const featured = lowerNames(featuredArtistNames(song));
  return lowerNames(names).every((name) => !featured.includes(name));
}

export function filterSongs(songs: Song[], args: CommonArgs): Song[] {
  return songs.filter((song) => {
    const { artistNames, title, primaryArtist } = songText(song);
    const year = releaseYear(song);

    if (!includesAny(artistNames, args.artistContains)) return false;
    if (!includesAny(title, args.titleContains)) return false;
    if (!includesAny(primaryArtist, args.primaryArtist)) return false;
    if (!includesNone(primaryArtist, args.excludePrimaryArtist)) return false;
    if (!isFeatureOf(song, args.featureOf)) return false;
    if (!hasFeaturedArtists(song, args.featuredArtist)) return false;
    if (!hasNoFeaturedArtists(song, args.excludeFeaturedArtist)) return false;
    if (args.year !== undefined && year !== args.year) return false;
    if (args.yearFrom !== undefined && (year === null || year < args.yearFrom)) return false;
    if (args.yearTo !== undefined && (year === null || year > args.yearTo)) return false;
    if (args.hasFeatures && !hasFeatures(song)) return false;
    if (args.noFeatures && hasFeatures(song)) return false;

    return true;
  });
}

export function dedupeSongs(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const { artistNames, title } = songText(song);
    const key = `${artistNames.toLowerCase()}::${title.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function selectSongs(songs: Song[], start: number, count?: number): SelectedSong[] {
  if (start < 1) {
    throw new Error("--start must be >= 1");
  }
  const indexed = songs.map((song, index) => [index + 1, song] as SelectedSong);
  return indexed.slice(start - 1, count ? start - 1 + count : undefined);
}
