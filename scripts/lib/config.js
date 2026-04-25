const path = require("node:path");

const SKILL_ROOT = path.resolve(__dirname, "..", "..");
const RUNTIME_DIR = path.join(SKILL_ROOT, ".runtime");

module.exports = {
  SKILL_ROOT,
  RUNTIME_DIR,
  GENIUS_HEADERS: {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest"
  },
  SONGS_PER_PAGE: 50,
  DEFAULT_SEARCH_RESULTS: 8,
  MIN_MATCH_SCORE: 25,
  YTDLP_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  FFMPEG_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,
  LIST_OPTIONS: new Set([
    "artistContains",
    "titleContains",
    "featureOf",
    "featuredArtist",
    "excludeFeaturedArtist",
    "primaryArtist",
    "excludePrimaryArtist"
  ]),
  NUMBER_OPTIONS: new Set(["artistId", "maxPages", "start", "count", "year", "yearFrom", "yearTo", "concurrency"]),
  BOOLEAN_OPTIONS: new Set(["hasFeatures", "noFeatures", "manifestOnly"]),
  POSITIVE_HINTS: ["official audio", "provided to youtube", "topic"],
  NEGATIVE_HINTS: ["music video", "lyric video", "lyrics video", "live", "karaoke", "reaction", "cover"],
  VARIANT_HINTS: ["instrumental", "remix", "edit", "radio", "clean", "acapella", "sped up", "slowed", "nightcore"],
  STOPWORDS: new Set(["a", "an", "and", "at", "by", "for", "in", "it", "of", "on", "or", "the", "to", "up"])
};
