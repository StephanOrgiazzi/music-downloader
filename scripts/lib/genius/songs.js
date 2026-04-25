const { SONGS_PER_PAGE } = require("../config");
const { fetchJson } = require("./api");
const { normalizeText, includesAny, includesNone } = require("../text");

function primaryArtistName(song) {
  return normalizeText(song.primary_artist_names || (song.primary_artist && song.primary_artist.name) || song.artist_names || "");
}

function featuredArtistNames(song) {
  return (song.featured_artists || []).map((artist) => normalizeText(artist.name || "")).filter(Boolean);
}

function releaseYear(song) {
  const raw = song.release_date_components && song.release_date_components.year;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\d{4}$/.test(raw)) return Number(raw);
  const fallback = song.release_date_for_display || song.release_date_with_abbreviated_month_for_display || "";
  const match = String(fallback).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function pageviews(song) {
  const raw = song.stats && song.stats.pageviews;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

function songText(song) {
  return {
    artistNames: normalizeText(song.artist_names || ""),
    title: normalizeText(song.title || ""),
    primaryArtist: primaryArtistName(song)
  };
}

function hasFeatures(song) {
  if (featuredArtistNames(song).length > 0) return true;
  const artistNames = normalizeText(song.artist_names).toLowerCase();
  return artistNames.includes("(ft.") || artistNames.includes("(feat.") || artistNames.includes(" featuring ");
}

function lowerNames(values) {
  return (values || []).map((value) => normalizeText(value).toLowerCase());
}

function isFeatureOf(song, names) {
  if (!names || names.length === 0) return true;
  const primary = primaryArtistName(song).toLowerCase();
  const featured = lowerNames(featuredArtistNames(song));
  const artistLine = normalizeText(song.artist_names).toLowerCase();
  return lowerNames(names).every((name) => featured.includes(name) || (artistLine.includes(name) && !primary.includes(name)));
}

function hasFeaturedArtists(song, names) {
  if (!names || names.length === 0) return true;
  const featured = lowerNames(featuredArtistNames(song));
  return lowerNames(names).every((name) => featured.includes(name));
}

function hasNoFeaturedArtists(song, names) {
  if (!names || names.length === 0) return true;
  const featured = lowerNames(featuredArtistNames(song));
  return lowerNames(names).every((name) => !featured.includes(name));
}

function matchesSong(song, args) {
  const text = songText(song);
  const year = releaseYear(song);
  if (!includesAny(text.artistNames, args.artistContains)) return false;
  if (!includesAny(text.title, args.titleContains)) return false;
  if (!includesAny(text.primaryArtist, args.primaryArtist)) return false;
  if (!includesNone(text.primaryArtist, args.excludePrimaryArtist)) return false;
  if (!isFeatureOf(song, args.featureOf)) return false;
  if (!hasFeaturedArtists(song, args.featuredArtist)) return false;
  if (!hasNoFeaturedArtists(song, args.excludeFeaturedArtist)) return false;
  if (args.year !== undefined && year !== args.year) return false;
  if (args.yearFrom !== undefined && (year === null || year < args.yearFrom)) return false;
  if (args.yearTo !== undefined && (year === null || year > args.yearTo)) return false;
  if (args.hasFeatures && !hasFeatures(song)) return false;
  if (args.noFeatures && hasFeatures(song)) return false;
  return true;
}

async function collectSongs(artistId, args) {
  const limit = args.count ? args.start - 1 + args.count : undefined;
  const songs = [];
  const seenIds = new Set();
  const seenKeys = new Set();
  const concurrency = Math.max(1, Math.min(args.concurrency || 6, 12));

  for (let page = 1; page <= args.maxPages; page += concurrency) {
    const pages = Array.from(
      { length: Math.min(concurrency, args.maxPages - page + 1) },
      (_, index) => page + index
    );
    const payloads = await Promise.all(
      pages.map(async (pageNumber) => {
        const url = `https://genius.com/api/artists/${artistId}/songs?page=${pageNumber}&per_page=${SONGS_PER_PAGE}&sort=popularity&text_format=preview`;
        return { pageNumber, payload: await fetchJson(url) };
      })
    );

    let sawNextPage = false;
    for (const { payload } of payloads.sort((left, right) => left.pageNumber - right.pageNumber)) {
      const response = payload.response || {};
      const pageSongs = Array.isArray(response.songs) ? response.songs : [];
      if (pageSongs.length === 0) return songs;
      if (response.next_page) sawNextPage = true;

      for (const song of pageSongs) {
        if (seenIds.has(song.id) || !matchesSong(song, args)) continue;
        seenIds.add(song.id);
        const text = songText(song);
        const key = `${text.artistNames.toLowerCase()}::${text.title.toLowerCase()}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        songs.push(song);
        if (limit && songs.length >= limit) return songs;
      }
    }

    if (!sawNextPage) break;
  }

  return songs;
}

function selectedSongs(songs, start, count) {
  if (start < 1) throw new Error("--start must be >= 1");
  const indexed = songs.map((song, index) => [index + 1, song]);
  return indexed.slice(start - 1, count ? start - 1 + count : undefined);
}

function serializeSong(index, song) {
  return {
    index,
    id: song.id,
    artist: song.artist_names || "",
    primary_artist: primaryArtistName(song),
    title: song.title || "",
    url: song.url || "",
    release_year: releaseYear(song),
    pageviews: pageviews(song),
    featured_artists: featuredArtistNames(song)
  };
}

function writeManifest(outputDir, entries, artist) {
  const fs = require("node:fs");
  const path = require("node:path");
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = {
    artist_id: artist.artistId,
    artist_name: artist.artistName,
    songs_url: artist.songsUrl,
    selected: entries.map(([index, song]) => serializeSong(index, song))
  };
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

module.exports = {
  primaryArtistName,
  featuredArtistNames,
  releaseYear,
  pageviews,
  songText,
  hasFeatures,
  matchesSong,
  collectSongs,
  selectedSongs,
  serializeSong,
  writeManifest
};
