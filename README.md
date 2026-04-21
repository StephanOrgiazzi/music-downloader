# Music Downloader Agent Skill

Music downloader agent skill for complex catalog queries.

It is built for requests such as:
- "Download all songs where Method Man is featured between 1995 and 2004."
- "Download all songs Trackmasters produced for 50 Cent."
- "Download all 2pac songs that were not released on his own albums."

The skill installs its runtime locally and keeps downloads, manifests, and temporary binaries inside the project folder.

Genius metadata is resolved through Genius JSON endpoints, not HTML scraping, to keep the runtime lighter and less brittle.

## Usage

Just prompt your agent what music you want to download
