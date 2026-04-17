---
name: music-downloader
description: Cross-platform music downloader skill using TypeScript, Genius metadata, yt-dlp, and ffmpeg. Use when Codex needs to fetch songs from a Genius artist page, filter them, and download MP3 files on Windows, macOS, or Linux.
---

# Music Downloader

## Setup

If `node` or `npm` is missing, install Node.js LTS first with the host package manager, then continue. The skill must work the same way on Windows, macOS, and Linux.

```sh
cd /path/to/music-downloader
npm run use
```

Run `npm run use` before each preview or download. This installs dependencies into the skill, refreshes `yt-dlp`, and keeps runtime files under the skill folder.

## Commands

Preview:

```sh
cd /path/to/music-downloader
npm run use
node ./run.mjs preview --artist-url "https://genius.com/artists/Trackmasters/songs" --count 30 --output-dir "output/trackmasters-first-30"
```

Download:

```sh
cd /path/to/music-downloader
npm run use
node ./run.mjs download --artist-url "https://genius.com/artists/Method-man/songs" --feature-of "Method Man" --year-from 1994 --year-to 2006 --output-dir "output/method-man-features-1994-2006"
```

Cookies:

```sh
cd /path/to/music-downloader
npm run use
node ./run.mjs download --artist-url "https://genius.com/artists/Trackmasters/songs" --cookies-from-browser "chrome" --output-dir "output/trackmasters-cookies"
```

## Main Filters

- `--count`, `--start`
- `--artist-contains`, `--title-contains`
- `--feature-of`, `--featured-artist`, `--exclude-featured-artist`
- `--primary-artist`, `--exclude-primary-artist`
- `--year`, `--year-from`, `--year-to`
- `--has-features`, `--no-features`

If Genius metadata or YouTube search is not enough, use web research to resolve gaps before downloading.

Relative paths are resolved from the skill root, so `output/...` and runtime files always stay inside the skill folder.

Use `node ./run.mjs ...` as the entry command. Do not rely on shell-specific syntax or cwd-specific paths.

Entrypoint: [scripts/src/cli.ts](./scripts/src/cli.ts)
