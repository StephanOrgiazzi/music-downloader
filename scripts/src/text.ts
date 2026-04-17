import type { Song } from "./types.js";

const TEXT_REPLACEMENTS = [
  ["JAŸ-Z", "Jay-Z"],
  ["JAÅ¸-Z", "Jay-Z"],
  ["Mýa", "Mya"],
  ["\u2019", "'"],
  ["\u2018", "'"],
  ["\u201c", '"'],
  ["\u201d", '"'],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u29f8", "/"]
] as const;

const STOPWORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "it", "of", "on", "or", "the", "to", "up"]);

function normalizedLowercase(value: string): string {
  return normalizeText(value).toLowerCase();
}

export function normalizeText(value: string): string {
  return TEXT_REPLACEMENTS.reduce((text, [from, to]) => text.replaceAll(from, to), value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(value: string): string[] {
  return normalizeText(value).toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function significantWords(value: string): string[] {
  return words(value).filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

export function includesAny(haystack: string, values?: string[]): boolean {
  if (!values || values.length === 0) {
    return true;
  }
  const text = normalizedLowercase(haystack);
  return values.some((value) => text.includes(normalizedLowercase(value)));
}

export function includesNone(haystack: string, values?: string[]): boolean {
  if (!values || values.length === 0) {
    return true;
  }
  const text = normalizedLowercase(haystack);
  return values.every((value) => !text.includes(normalizedLowercase(value)));
}

export function sanitizeFilename(value: string): string {
  return normalizeText(value)
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
}

export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function primaryArtistName(song: Song): string {
  return normalizeText(song.primary_artist_names ?? song.primary_artist?.name ?? song.artist_names ?? "");
}

export function featuredArtistNames(song: Song): string[] {
  return (song.featured_artists ?? [])
    .map((artist) => normalizeText(artist.name ?? ""))
    .filter(Boolean);
}

export function songText(song: Song): { artistNames: string; title: string; primaryArtist: string } {
  return {
    artistNames: normalizeText(song.artist_names),
    title: normalizeText(song.title),
    primaryArtist: primaryArtistName(song)
  };
}
