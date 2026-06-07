import { getAppSettings } from "../settings/app-settings.js";
import type { Library, StremioCatalogMeta, StremioVideo, TmdbWatchProvider } from "../libraries/types.js";

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
  vote_average?: number;
  genre_ids?: number[];
};

type TmdbGenre = { id: number; name: string };
type TmdbVideo = { key: string; site: string; type: string };
type TmdbEpisode = { episode_number: number; name?: string; overview?: string; air_date?: string; still_path?: string | null };
type TmdbSeason = { season_number: number; episodes?: TmdbEpisode[] };

type TmdbDetail = TmdbItem & {
  runtime?: number;
  episode_run_time?: number[];
  genres?: TmdbGenre[];
  videos?: { results?: TmdbVideo[] };
  seasons?: Array<{ season_number: number; episode_count?: number }>;
  external_ids?: TmdbExternalIds;
};

type TmdbExternalIds = {
  imdb_id?: string | null;
};

type TmdbFindResult = {
  movie_results?: TmdbItem[];
  tv_results?: TmdbItem[];
};

type TmdbWatchProviderResult = {
  results?: Array<{ provider_id: number; provider_name: string; logo_path?: string | null }>;
};

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

export async function fetchTmdbCatalog(library: Library, page = 1): Promise<StremioCatalogMeta[]> {
  const settings = getAppSettings();
  assertTmdbConfigured(settings);

  const list = await tmdbRequest<TmdbListResult>(buildLibraryPath(library), buildLibraryQuery(library, settings, page), settings);
  const metas = await Promise.all(
    list.results.slice(0, 30).map((item) => mapTmdbItemToMeta(library, item, settings).catch(() => null))
  );
  return metas.filter((item): item is StremioCatalogMeta => Boolean(item));
}

export async function fetchTmdbMeta(type: "movie" | "series", imdbId: string): Promise<StremioCatalogMeta | null> {
  const settings = getAppSettings();
  assertTmdbConfigured(settings);

  const tmdbId = await findTmdbIdByImdb(type, imdbId, settings);
  if (!tmdbId) return null;

  const detailPath = type === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const detail = await tmdbRequest<TmdbDetail>(detailPath, {
    language: settings.tmdbLanguage,
    append_to_response: "videos,external_ids"
  }, settings);

  const baseMeta = mapDetailToMeta(type, imdbId, detail);
  if (type === "series") {
    baseMeta.videos = await fetchSeriesVideos(tmdbId, imdbId, detail, settings);
  }
  return baseMeta;
}

export async function fetchTmdbWatchProviders(type: "movie" | "series", region?: string): Promise<TmdbWatchProvider[]> {
  const settings = getAppSettings();
  assertTmdbConfigured(settings);
  const path = type === "movie" ? "/watch/providers/movie" : "/watch/providers/tv";
  const data = await tmdbRequest<TmdbWatchProviderResult>(path, {
    language: settings.tmdbLanguage,
    watch_region: region ?? settings.tmdbRegion
  }, settings);
  return (data.results ?? []).map((provider) => ({
    id: provider.provider_id,
    name: provider.provider_name,
    logo: provider.logo_path ? `${IMAGE_BASE_URL}/w92${provider.logo_path}` : undefined
  }));
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
    releaseInfo: releaseDate?.slice(0, 4),
    released: releaseDate ? new Date(releaseDate).toISOString() : undefined,
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined
  };
}

function mapDetailToMeta(type: "movie" | "series", imdbId: string, detail: TmdbDetail): StremioCatalogMeta {
  const releaseDate = type === "movie" ? detail.release_date : detail.first_air_date;
  const name = detail.title ?? detail.name ?? imdbId;
  const trailer = detail.videos?.results?.find((video) => video.site === "YouTube" && video.type === "Trailer");
  const runtime = type === "movie" ? detail.runtime : detail.episode_run_time?.[0];
  return {
    id: imdbId,
    type,
    name,
    poster: detail.poster_path ? `${IMAGE_BASE_URL}/w500${detail.poster_path}` : undefined,
    background: detail.backdrop_path ? `${IMAGE_BASE_URL}/original${detail.backdrop_path}` : undefined,
    description: detail.overview || undefined,
    releaseInfo: releaseDate?.slice(0, 4),
    released: releaseDate ? new Date(releaseDate).toISOString() : undefined,
    imdbRating: detail.vote_average ? detail.vote_average.toFixed(1) : undefined,
    genres: detail.genres?.map((genre) => genre.name),
    runtime: runtime ? `${runtime} min` : undefined,
    trailers: trailer ? [{ source: trailer.key, type: "Trailer" }] : undefined
  };
}

async function fetchSeriesVideos(tmdbId: number, imdbId: string, detail: TmdbDetail, settings: ReturnType<typeof getAppSettings>): Promise<StremioVideo[]> {
  const seasons = (detail.seasons ?? [])
    .filter((season) => season.season_number > 0 && (season.episode_count ?? 0) > 0)
    .slice(0, 30);
  const allVideos: StremioVideo[] = [];

  for (const season of seasons) {
    const seasonDetail = await tmdbRequest<TmdbSeason>(`/tv/${tmdbId}/season/${season.season_number}`, { language: settings.tmdbLanguage }, settings).catch(() => null);
    for (const episode of seasonDetail?.episodes ?? []) {
      allVideos.push({
        id: `${imdbId}:${season.season_number}:${episode.episode_number}`,
        title: episode.name || `S${season.season_number}E${episode.episode_number}`,
        released: episode.air_date ? new Date(episode.air_date).toISOString() : undefined,
        season: season.season_number,
        episode: episode.episode_number,
        overview: episode.overview || undefined,
        thumbnail: episode.still_path ? `${IMAGE_BASE_URL}/w300${episode.still_path}` : undefined
      });
    }
  }

  return allVideos;
}

async function findTmdbIdByImdb(type: "movie" | "series", imdbId: string, settings: ReturnType<typeof getAppSettings>): Promise<number | undefined> {
  const data = await tmdbRequest<TmdbFindResult>(`/find/${encodeURIComponent(imdbId)}`, {
    external_source: "imdb_id",
    language: settings.tmdbLanguage
  }, settings);
  const result = type === "movie" ? data.movie_results?.[0] : data.tv_results?.[0];
  return result?.id;
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
    query.sort_by = config.sortBy ?? "popularity.desc";
    query.include_adult = config.includeAdult ?? false;
    if (config.withGenres) query.with_genres = config.withGenres;
    if (config.withKeywords) query.with_keywords = config.withKeywords;
    if (config.withOriginalLanguage) query.with_original_language = config.withOriginalLanguage;
    if (config.withWatchProviders) query.with_watch_providers = config.withWatchProviders;
    query.watch_region = config.watchRegion ?? settings.tmdbRegion;
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

function assertTmdbConfigured(settings: ReturnType<typeof getAppSettings>): void {
  if (!settings.tmdbReadAccessToken && !settings.tmdbApiKey) {
    throw new Error("TMDB API key or read access token is not configured.");
  }
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
