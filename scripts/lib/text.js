const { STOPWORDS } = require("./config");

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

function containsPhrase(text, phrase) {
  return normalizeText(text).toLowerCase().includes(normalizeText(phrase).toLowerCase());
}

function countMatches(needles, text) {
  return needles.filter((word) => text.includes(word)).length;
}

module.exports = {
  normalizeText,
  words,
  significantWords,
  includesAny,
  includesNone,
  sanitizeFilename,
  titleFromSlug,
  containsPhrase,
  countMatches
};
