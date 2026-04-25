const { DEFAULT_SEARCH_RESULTS, MIN_MATCH_SCORE, POSITIVE_HINTS, NEGATIVE_HINTS, VARIANT_HINTS } = require("../config");
const { normalizeText, significantWords, containsPhrase, countMatches } = require("../text");
const { primaryArtistName, featuredArtistNames, releaseYear } = require("../genius/songs");

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

function requestedVariant(song, variant) {
  return containsPhrase(`${song.artist_names} ${song.title}`, variant);
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

function runJson(command, args) {
  const { execFileSync } = require("node:child_process");
  const stdout = execFileSync(command, args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const line = stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).at(-1);
  if (!line) throw new Error(`${command} returned no JSON payload.`);
  return JSON.parse(line);
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

module.exports = { buildQuery, parseCandidate, scoreCandidate, chooseYoutubeSource };
