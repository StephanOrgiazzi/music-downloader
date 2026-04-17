# Music Downloader

Cross-platform music downloader for complex catalog queries.

It is built for requests such as:
- "Download all songs where Method Man is featured between 1995 and 2004."
- "Download all songs Trackmasters produced for 50 Cent."
- "Download all songs with Redman as a featured artist in 2001."

The skill installs its runtime locally and keeps downloads, manifests, and temporary binaries inside the project folder.

## Setup

Requires `Node.js` and `npm`.

```sh
cd /path/to/music-downloader
npm run use
```

## Usage

Preview a selection:

```sh
node ./run.mjs preview --artist-url "https://example.com/artist-page" --feature-of "Method Man" --year-from 1995 --year-to 2004 --output-dir "output/method-man-features-1995-2004"
```

Download files:

```sh
node ./run.mjs download --artist-url "https://example.com/artist-page" --primary-artist "50 Cent" --output-dir "output/trackmasters-for-50-cent"
```

Relative paths are resolved from the project root, so outputs always stay inside the project folder.

## License

[MIT](./LICENSE)
