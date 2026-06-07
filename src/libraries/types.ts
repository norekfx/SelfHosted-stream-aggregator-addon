export type LibraryMediaType = "movie" | "series";
export type LibrarySource = "tmdb";
export type LibraryMode = "discover" | "trending" | "popular" | "top_rated" | "now_playing" | "upcoming" | "airing_today" | "on_the_air";

export type LibraryConfig = {
  language?: string;
  region?: string;
  sortBy?: string;
  withGenres?: string;
  withKeywords?: string;
  withOriginalLanguage?: string;
  withWatchProviders?: string;
  watchRegion?: string;
  primaryReleaseDateGte?: string;
  primaryReleaseDateLte?: string;
  firstAirDateGte?: string;
  firstAirDateLte?: string;
  year?: string;
  voteAverageGte?: number;
  voteCountGte?: number;
  itemLimit?: number;
  includeAdult?: boolean;
  timeWindow?: "day" | "week";
};

export type Library = {
  id: string;
  name: string;
  slug: string;
  type: LibraryMediaType;
  source: LibrarySource;
  mode: LibraryMode;
  enabled: boolean;
  sortOrder: number;
  config: LibraryConfig;
  createdAt: string;
  updatedAt: string;
};

export type LibraryInput = {
  name: string;
  slug?: string;
  type: LibraryMediaType;
  source?: LibrarySource;
  mode: LibraryMode;
  enabled?: boolean;
  sortOrder?: number;
  config?: LibraryConfig;
};

export type StremioVideo = {
  id: string;
  title: string;
  released?: string;
  season?: number;
  episode?: number;
  overview?: string;
  thumbnail?: string;
};

export type StremioCatalogMeta = {
  id: string;
  type: LibraryMediaType;
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  released?: string;
  imdbRating?: string;
  genres?: string[];
  runtime?: string;
  trailers?: Array<{ source: string; type: "Trailer" }>;
  videos?: StremioVideo[];
};

export type TmdbWatchProvider = {
  id: number;
  name: string;
  logo?: string;
};
