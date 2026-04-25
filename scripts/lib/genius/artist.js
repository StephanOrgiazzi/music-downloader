const { fetchJson } = require("./api");
const { normalizeText, titleFromSlug } = require("../text");

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

module.exports = { normalizeArtistUrl, fetchArtistById, searchArtistBySlug, resolveArtist };
