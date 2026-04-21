---
name: music-downloader
description: Collect songs from a Genius artist page, filter the list and download MP3 files through auto-managed yt-dlp and ffmpeg binaries
---

# Music Downloader

Entrypoint: [scripts/music-downloader.js](./scripts/music-downloader.js)

Run with Node.js 18+. Do not run `npm install`; the script auto-manages `yt-dlp` and `ffmpeg` in `.runtime`.

At any time during the various processes, you can use websearch if you need extra info to help the agent fulfills the user query.

## Usage

```sh
node C:\Users\steph\.codex\skills\music-downloader\scripts\music-downloader.js doctor
node C:\Users\steph\.codex\skills\music-downloader\scripts\music-downloader.js preview --artist-url "https://genius.com/artists/<artist>/songs" --output-dir "<dir>" [filters]
node C:\Users\steph\.codex\skills\music-downloader\scripts\music-downloader.js download --artist-url "https://genius.com/artists/<artist>/songs" --output-dir "<dir>" [filters]
```

Use the actual skill path on the host OS; the script itself is cross-platform.

Use `preview` first for non-trivial filters. It writes `manifest.json` and `manifest.txt` without downloading audio. Use `download` only after the manifest selection looks correct.

## Filters

- Source: `--artist-url`, `--artist-id`, `--max-pages`, `--concurrency`.
- Paging: `--start`, `--count`.
- Text: `--artist-contains`, `--title-contains`.
- Features: `--feature-of`, `--featured-artist`, `--exclude-featured-artist`, `--has-features`, `--no-features`.
- Primary artist: `--primary-artist`, `--exclude-primary-artist`.
- Years: `--year`, `--year-from`, `--year-to`.
- Download: `--query-template`, `--cookies-from-browser`, `--cookies-file`, `--manifest-only`.

Repeat list filters when needed, for example `--title-contains remix --title-contains edit`.

If Genius metadata or YouTube matching is ambiguous, narrow filters or adjust `--query-template` before downloading.
