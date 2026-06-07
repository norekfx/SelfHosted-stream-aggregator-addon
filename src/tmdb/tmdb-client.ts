import { getAppSettings } from "../settings/app-settings.js";
import type { Library, StremioCatalogMeta } from "../libraries/types.js";

type TmdbListResult = {
  page: number;
  results: TmdbItem[];
  total_pages: number;
  total_results: number;
};

type TmdbItem = {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
};

type TmdbExternalIds = {
  imdb_id?: string | null;
};

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

export async function fetchTmdbCatalog(library: Library, page = 1): Promise<StremioCatalogMeta[]> {
  const settings = getAppSettings();
  if (!settings.tmdbReadAccessToken && !settings.tmdbApiKey) {
    throw new Error("TMDB API key or read access token is not configured.");
  }

  const list = await tmdbRequest<TmdbListResult>(buildLibraryPath(library), buildLibraryQuery(library, settings, page), settings);
  const metas = await Promise.all(
    list.results.slice(0, 30).map((item) => mapTmdbItemToMeta(library, item, settings).catch(() => null))
  );
  return metas.filter((item): item is StremioCatalogMeta => Boolean(item));
}

async function mapTmdbItemToMeta(library: Library, item: TmdbItem, settings: ReturnType<typeof getAppSettings>): Promise<StremioCatalogMeta | null> {
  const imdbId = await getImdbId(library, item.id, settings);
  if (!imdbId) return null;

  const releaseDate = library.type === "movie" ? item.release_date : item.first_air_date;
  const name = item.title ?? item.name;
  if (!name) return null;

  return {
    id: imdbId,
    type: library.type,
    name,
    poster: item.poster_path ? `${IMAGE_BASE_URL}/w500${item.poster_path}` : undefined,
    background: item.backdrop_path ? `${IMAGE_BASE_URL}/original${item.backdrop_path}` : undefined,
    description: item.overview || undefined,
    releaseInfo: releaseDate?.slice(0, 4)
  };
}

async function getImdbId(library: Library, tmdbId: number, settings: ReturnType<typeof getAppSettings>): Promise<string | undefined> {
  const path = library.type === "movie" ? `/movie/${tmdbId}/external_ids` : `/tv/${tmdbId}/external_ids`;
  const externalIds = await tmdbRequest<TmdbExternalIds>(path, {}, settings);
  const imdbId = externalIds.imdb_id ?? undefined;
  return imdbId && /^tt\d+$/i.test(imdbId) ? imdbId : undefined;
}

function buildLibraryPath(library: Library): string {
  if (library.mode === "trending") {
    return `/trending/${library.type === "movie" ? "movie" : "tv"}/${library.config.timeWindow ?? "week"}`;
  }

  if (library.mode === "discover") {
    return library.type === "movie" ? "/discover/movie" : "/discover/tv";
  }

  if (library.type === "movie") {
    if (library.mode === "now_playing") return "/movie/now_playing";
    if (library.mode === "upcoming") return "/movie/upcoming";
    if (library.mode === "top_rated") return "/movie/top_rated";
    return "/movie/popular";
  }

  if (library.mode === "airing_today") return "/tv/airing_today";
  if (library.mode === "on_the_air") return "/tv/on_the_air";
  if (library.mode === "top_rated") return "/tv/top_rated";
  return "/tv/popular";
}

function buildLibraryQuery(library: Library, settings: ReturnType<typeof getAppSettings>, page: number): Record<string, string | number | boolean> {
  const config = library.config;
  const query: Record<string, string | number | boolean> = {
    page,
    language: config.language ?? settings.tmdbLanguage,
    region: config.region ?? settings.tmdbRegion
  };

  if (library.mode === "discover") {
    query.sort_by = config.sortBy ?? (library.type === "movie" ? "popularity.desc" : "popularity.desc");
    query.include_adult = config.includeAdult ?? false;
    if (config.withGenres) query.with_genres = config.withGenres;
    if (config.withKeywords) query.with_keywords = config.withKeywords;
    if (config.withOriginalLanguage) query.with_original_language = config.withOriginalLanguage;
    if (config.withWatchProviders) query.with_watch_providers = config.withWatchProviders;
    if (config.watchRegion) query.watch_region = config.watchRegion;
    if (config.voteAverageGte !== undefined) query["vote_average.gte"] = config.voteAverageGte;
    if (config.voteCountGte !== undefined) query["vote_count.gte"] = config.voteCountGte;
    if (config.year) query[library.type === "movie" ? "primary_release_year" : "first_air_date_year"] = config.year;
    if (config.primaryReleaseDateGte) query["primary_release_date.gte"] = config.primaryReleaseDateGte;
    if (config.primaryReleaseDateLte) query["primary_release_date.lte"] = config.primaryReleaseDateLte;
    if (config.firstAirDateGte) query["first_air_date.gte"] = config.firstAirDateGte;
    if (config.firstAirDateLte) query["first_air_date.lte"] = config.firstAirDateLte;
  }

  return query;
}

async function tmdbRequest<T>(path: string, query: Record<string, string | number | boolean>, settings: ReturnType<typeof getAppSettings>): Promise<T> {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (settings.tmdbReadAccessToken) {
    headers.authorization = `Bearer ${settings.tmdbReadAccessToken}`;
  } else if (settings.tmdbApiKey) {
    url.searchParams.set("api_key", settings.tmdbApiKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`TMDB request failed with HTTP ${response.status}.`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}
