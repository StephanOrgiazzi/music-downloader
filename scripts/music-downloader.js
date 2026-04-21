#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync, execFileSync } = require("node:child_process");

const GENIUS_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest"
};
const SONGS_PER_PAGE = 50;
const DEFAULT_SEARCH_RESULTS = 8;
const MIN_MATCH_SCORE = 25;
const LIST_OPTIONS = new Set([
  "artistContains",
  "titleContains",
  "featureOf",
  "featuredArtist",
  "excludeFeaturedArtist",
  "primaryArtist",
  "excludePrimaryArtist"
]);
const NUMBER_OPTIONS = new Set(["artistId", "maxPages", "start", "count", "year", "yearFrom", "yearTo", "concurrency"]);
const BOOLEAN_OPTIONS = new Set(["hasFeatures", "noFeatures", "manifestOnly"]);
const POSITIVE_HINTS = ["official audio", "provided to youtube", "topic"];
const NEGATIVE_HINTS = ["music video", "lyric video", "lyrics video", "live", "karaoke", "reaction", "cover"];
const VARIANT_HINTS = ["instrumental", "remix", "edit", "radio", "clean", "acapella", "sped up", "slowed", "nightcore"];
const STOPWORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "it", "of", "on", "or", "the", "to", "up"]);
const SKILL_ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(SKILL_ROOT, ".runtime");
const YTDLP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FFMPEG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function usage() {
  console.log(`Usage:
  node music-downloader.js doctor
  node music-downloader.js preview --artist-url <url> --output-dir <dir> [options]
  node music-downloader.js download --artist-url <url> --output-dir <dir> [options]

Core options:
  --artist-url, --artist-id, --output-dir, --max-pages, --start, --count
  --artist-contains, --title-contains, --feature-of, --featured-artist
  --exclude-featured-artist, --primary-artist, --exclude-primary-artist
  --year, --year-from, --year-to, --has-features, --no-features
  --query-template, --cookies-from-browser, --cookies-file, --manifest-only, --concurrency`);
}

function toCamel(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgs(argv) {
  const command = argv[2];
  const args = {
    command,
    maxPages: 60,
    concurrency: 6,
    start: 1,
    queryTemplate: "{artist} - {title}",
    manifestOnly: false,
    hasFeatures: false,
    noFeatures: false
  };

  for (let i = 3; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`);

    const eq = raw.indexOf("=");
    const rawName = raw.slice(2, eq === -1 ? undefined : eq);
    const name = toCamel(rawName);
    let value = eq === -1 ? undefined : raw.slice(eq + 1);

    if (BOOLEAN_OPTIONS.has(name)) {
      args[name] = value === undefined ? true : !["false", "0", "no"].includes(String(value).toLowerCase());
      continue;
    }

    if (value === undefined) {
      i += 1;
      value = argv[i];
    }
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${rawName}`);

    if (NUMBER_OPTIONS.has(name)) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) throw new Error(`--${rawName} must be a number`);
      args[name] = numberValue;
    } else if (LIST_OPTIONS.has(name)) {
      args[name] = [...(args[name] || []), value];
    } else {
      args[name] = value;
    }
  }

  return args;
}

function normalizeText(value = "") {
  return String(value)
    .replaceAll("JAŸ-Z", "Jay-Z")
    .replaceAll("JAÅ¸-Z", "Jay-Z")
    .replaceAll("Mýa", "Mya")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u29f8/g, "/")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return normalizeText(value).toLowerCase().match(/[a-z0-9]+/g) || [];
}

function significantWords(value) {
  return words(value).filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function includesAny(haystack, values) {
  if (!values || values.length === 0) return true;
  const text = normalizeText(haystack).toLowerCase();
  return values.some((value) => text.includes(normalizeText(value).toLowerCase()));
}

function includesNone(haystack, values) {
  if (!values || values.length === 0) return true;
  const text = normalizeText(haystack).toLowerCase();
  return values.every((value) => !text.includes(normalizeText(value).toLowerCase()));
}

function sanitizeFilename(value) {
  return normalizeText(value).replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
}

function titleFromSlug(slug) {
  return decodeURIComponent(slug)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

async function fetchJson(url) {
  const response = await fetch(url, { headers: GENIUS_HEADERS });
  if (!response.ok) throw new Error(`Request failed for ${url}: ${response.status}`);
  return response.json();
}

function normalizeArtistUrl(artistUrl) {
  const parsed = new URL(artistUrl);
  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "genius.com") throw new Error(`Unsupported artist host: ${parsed.hostname}`);

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "artists" || parts.length < 2) {
    throw new Error("Artist URL must look like https://genius.com/artists/<slug> or /artists/<slug>/songs.");
  }
  return { slug: parts[1], songsUrl: `https://genius.com/artists/${parts[1]}/songs` };
}

async function fetchArtistById(artistId, songsUrl) {
  const payload = await fetchJson(`https://genius.com/api/artists/${artistId}`);
  const artist = payload && payload.response && payload.response.artist;
  if (!artist || !artist.id) throw new Error(`Could not resolve Genius artist id ${artistId}`);
  return {
    artistId: artist.id,
    artistName: artist.name || `artist-${artist.id}`,
    songsUrl: songsUrl || `${artist.url || `https://genius.com/artists/${artist.slug || artist.id}`}/songs`
  };
}

async function searchArtistBySlug(slug, songsUrl) {
  const query = titleFromSlug(slug);
  const payload = await fetchJson(`https://genius.com/api/search/artist?q=${encodeURIComponent(query)}`);
  const sections = (payload.response && payload.response.sections) || [];
  const hits = sections
    .filter((section) => section.type === "artist")
    .flatMap((section) => section.hits || [])
    .map((hit) => hit.result)
    .filter(Boolean);

  const normalizedSlug = slug.toLowerCase();
  const selected =
    hits.find((artist) => String(artist.slug || "").toLowerCase() === normalizedSlug) ||
    hits.find((artist) => String(artist.url || "").replace(/\/$/, "") === `https://genius.com/artists/${slug}`) ||
    hits.find((artist) => normalizeText(artist.name).toLowerCase() === normalizeText(query).toLowerCase()) ||
    hits[0];

  if (!selected) throw new Error(`Could not resolve Genius artist for slug "${slug}".`);
  return { artistId: selected.id, artistName: selected.name, songsUrl };
}

async function resolveArtist(args) {
  if (args.artistId !== undefined) {
    const normalized = args.artistUrl ? normalizeArtistUrl(args.artistUrl) : undefined;
    try {
      return await fetchArtistById(args.artistId, normalized && normalized.songsUrl);
    } catch (_) {
      const slug = normalized ? normalized.slug : `artist-${args.artistId}`;
      return { artistId: args.artistId, artistName: titleFromSlug(slug), songsUrl: normalized ? normalized.songsUrl : `https://genius.com/artists/${args.artistId}/songs` };
    }
  }
  if (!args.artistUrl) throw new Error("Provide --artist-url or --artist-id.");
  const normalized = normalizeArtistUrl(args.artistUrl);
  return searchArtistBySlug(normalized.slug, normalized.songsUrl);
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
  fs.mkdirSync(outputDir, { recursive: true });
  const lines = entries.map(([index, song]) => `${String(index).padStart(3, "0")}. ${normalizeText(song.artist_names)} - ${normalizeText(song.title)}`);
  const payload = {
    artist_id: artist.artistId,
    artist_name: artist.artistName,
    songs_url: artist.songsUrl,
    selected: entries.map(([index, song]) => serializeSong(index, song))
  };
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, "manifest.txt"), `${lines.join("\n")}\n`, "utf8");
}

function commandVersion(command, versionArgs = ["--version"]) {
  const result = spawnSync(command, versionArgs, { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr || "").split(/\r?\n/).find(Boolean) || "available";
}

function ytdlpPath() {
  return path.join(RUNTIME_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

function ytdlpUrl() {
  return ytdlpUrls()[0];
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

async function doctor() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  console.log(`node: ${process.version}`);
  if (nodeMajor < 18) throw new Error("Node.js 18+ is required for built-in fetch.");

  const ytdlp = await ensureYtDlp();
  const ffmpeg = ensureFfmpeg();
  console.log(`yt-dlp: ${commandVersion(ytdlp)} (${ytdlp})`);
  console.log(`ffmpeg: ${ffmpeg.version} (${ffmpeg.path})`);
}

function runJson(command, args) {
  const stdout = execFileSync(command, args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const line = stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).at(-1);
  if (!line) throw new Error(`${command} returned no JSON payload.`);
  return JSON.parse(line);
}

function countMatches(needles, text) {
  return needles.filter((word) => text.includes(word)).length;
}

function containsPhrase(text, phrase) {
  return normalizeText(text).toLowerCase().includes(normalizeText(phrase).toLowerCase());
}

function requestedVariant(song, variant) {
  return containsPhrase(`${song.artist_names} ${song.title}`, variant);
}

function buildQuery(song, template) {
  return template
    .replaceAll("{artist}", normalizeText(song.artist_names))
    .replaceAll("{primary_artist}", primaryArtistName(song))
    .replaceAll("{title}", normalizeText(song.title))
    .replaceAll("{year}", releaseYear(song) ? String(releaseYear(song)) : "")
    .replaceAll("{index}", "");
}

function parseCandidate(entry) {
  return {
    id: String(entry.id || ""),
    url: String(entry.webpage_url || entry.url || ""),
    title: normalizeText(String(entry.title || "")),
    channel: normalizeText(String(entry.channel || "")),
    uploader: normalizeText(String(entry.uploader || "")),
    description: normalizeText(String(entry.description || "")),
    viewCount: typeof entry.view_count === "number" ? entry.view_count : null,
    channelIsVerified: Boolean(entry.channel_is_verified)
  };
}

function scoreCandidate(song, candidate) {
  const titleWords = significantWords(song.title);
  const primaryWords = significantWords(primaryArtistName(song));
  const artistWords = significantWords(song.artist_names);
  const featuredWords = significantWords(featuredArtistNames(song).join(" "));
  const titleText = normalizeText(candidate.title).toLowerCase();
  const bodyText = [candidate.title, candidate.channel, candidate.uploader, candidate.description].join(" ").toLowerCase();

  const titleMatches = countMatches(titleWords, titleText);
  const primaryMatches = countMatches(primaryWords, bodyText);
  const artistMatches = countMatches(artistWords, bodyText);
  const featuredMatches = countMatches(featuredWords, bodyText);

  let score = titleMatches * 25 + primaryMatches * 12 + artistMatches * 6 + featuredMatches * 10;
  if (titleWords.length > 0 && titleMatches < Math.max(1, titleWords.length - 1)) score -= 100;
  if (primaryWords.length > 0 && primaryMatches === 0) score -= 40;
  if (containsPhrase(candidate.title, song.title)) score += 25;
  if (containsPhrase(candidate.title, `${primaryArtistName(song)} ${song.title}`)) score += 20;
  if (candidate.channelIsVerified) score += 10;
  if (POSITIVE_HINTS.some((hint) => bodyText.includes(hint))) score += 18;
  for (const hint of NEGATIVE_HINTS) if (bodyText.includes(hint)) score -= 35;
  for (const variant of VARIANT_HINTS) if (bodyText.includes(variant) && !requestedVariant(song, variant)) score -= 90;
  if (candidate.viewCount) score += Math.min(10, Math.floor(Math.log10(Math.max(candidate.viewCount, 1))));
  return score;
}

function chooseYoutubeSource(song, args) {
  const ytdlpArgs = ["-J"];
  if (args.cookiesFromBrowser) ytdlpArgs.push("--cookies-from-browser", args.cookiesFromBrowser);
  if (args.cookiesFile) ytdlpArgs.push("--cookies", args.cookiesFile);
  ytdlpArgs.push(`ytsearch${DEFAULT_SEARCH_RESULTS}:${buildQuery(song, args.queryTemplate)}`);

  const payload = runJson(args.ytdlpPath, ytdlpArgs);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const candidates = entries
    .filter((entry) => entry && typeof entry === "object")
    .map(parseCandidate)
    .map((candidate) => ({ candidate, score: scoreCandidate(song, candidate) }))
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best || best.score < MIN_MATCH_SCORE) return null;
  return {
    source: best.candidate.url || `https://www.youtube.com/watch?v=${best.candidate.id}`,
    label: `${best.candidate.channel || best.candidate.uploader} | ${best.candidate.title}`
  };
}

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
