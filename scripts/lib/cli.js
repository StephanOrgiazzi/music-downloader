const { LIST_OPTIONS, NUMBER_OPTIONS, BOOLEAN_OPTIONS } = require("./config");

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

module.exports = { usage, parseArgs };
