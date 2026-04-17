export type Song = {
  id: number;
  artist_names: string;
  title: string;
  url?: string;
  primary_artist_names?: string;
  primary_artist?: { name?: string };
  featured_artists?: Array<{ name?: string }>;
  release_date_components?: { year?: number | string };
  release_date_for_display?: string;
  release_date_with_abbreviated_month_for_display?: string;
  stats?: { pageviews?: number | string };
};

export type SearchCandidate = {
  id: string;
  url: string;
  title: string;
  channel: string;
  uploader: string;
  description: string;
  viewCount: number | null;
  channelIsVerified: boolean;
};

export type CommonArgs = {
  artistUrl?: string;
  artistId?: number;
  outputDir: string;
  maxPages: number;
  start: number;
  count?: number;
  artistContains?: string[];
  titleContains?: string[];
  featureOf?: string[];
  featuredArtist?: string[];
  excludeFeaturedArtist?: string[];
  primaryArtist?: string[];
  excludePrimaryArtist?: string[];
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  hasFeatures?: boolean;
  noFeatures?: boolean;
  manifestOnly?: boolean;
  queryTemplate: string;
  cookiesFromBrowser?: string;
  cookiesFile?: string;
};

export type ResolvedArtist = {
  artistId: number;
  artistName: string;
  songsUrl: string;
};

export type SelectedSong = [index: number, song: Song];

export type DownloadSource = {
  source: string;
  label: string;
};
