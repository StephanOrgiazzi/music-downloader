const { GENIUS_HEADERS } = require("../config");

async function fetchJson(url) {
  const response = await fetch(url, { headers: GENIUS_HEADERS });
  if (!response.ok) throw new Error(`Request failed for ${url}: ${response.status}`);
  return response.json();
}

module.exports = { fetchJson };
