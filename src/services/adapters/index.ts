import {
  CachedCatalog,
  CatalogCategory,
  CatalogItem,
  ConnectionTestResult,
  EpisodeItem,
  IptvConnection,
  MovieDetails,
  PlaybackSourceResolution,
  SeriesDetails,
} from '../../types/iptv';
import {
  clearCatalogCache,
  loadCachedCatalog,
  saveCachedCatalog,
} from '../storageService';
import { customApiAdapter, CustomApiProviderAdapter } from './customApiAdapter';
import { m3uAdapter, M3UProviderAdapter } from './m3uAdapter';
import { ProviderAdapter } from './types';
import { xtreamAdapter, XtreamProviderAdapter } from './xtreamAdapter';

export {
  customApiAdapter,
  CustomApiProviderAdapter,
  M3UProviderAdapter,
  XtreamProviderAdapter,
};
export type { ProviderAdapter };

export function getAdapterForConnection(connection: IptvConnection): ProviderAdapter {
  if (connection.type === 'xtream') {
    return xtreamAdapter;
  }
  if (connection.type === 'm3u') {
    return m3uAdapter;
  }
  return customApiAdapter;
}

export interface LoadedCatalogBundle {
  movieCategories: CatalogCategory[];
  movies: CatalogItem[];
  seriesCategories: CatalogCategory[];
  series: CatalogItem[];
  liveCategories: CatalogCategory[];
  liveStreams: CatalogItem[];
  fromCache: boolean;
  errors: string[];
}

export async function testProviderConnection(
  connection: IptvConnection
): Promise<ConnectionTestResult> {
  const adapter = getAdapterForConnection(connection);
  return adapter.testConnection(connection);
}

export async function loadProviderCatalog(
  connection: IptvConnection,
  options: { useCache: boolean; forceRefresh?: boolean }
): Promise<LoadedCatalogBundle> {
  if (options.forceRefresh) {
    clearCatalogCache(connection.id);
  } else if (options.useCache) {
    const cached = loadCachedCatalog(connection.id);
    if (cached) {
      return {
        movieCategories: cached.movieCategories,
        movies: cached.movies,
        seriesCategories: cached.seriesCategories,
        series: cached.series,
        liveCategories: cached.liveCategories,
        liveStreams: cached.liveStreams,
        fromCache: true,
        errors: [],
      };
    }
  }

  const adapter = getAdapterForConnection(connection);
  const errors: string[] = [];

  const [
    movieCatsRes,
    moviesRes,
    seriesCatsRes,
    seriesRes,
    liveCatsRes,
    liveRes,
  ] = await Promise.allSettled([
    adapter.getMovieCategories(connection),
    adapter.getMovies(connection),
    adapter.getSeriesCategories(connection),
    adapter.getSeries(connection),
    adapter.getLiveCategories(connection),
    adapter.getLiveStreams(connection),
  ]);

  const movieCategories =
    movieCatsRes.status === 'fulfilled' ? movieCatsRes.value : [];
  if (movieCatsRes.status === 'rejected') {
    errors.push(`Categorías de películas: ${movieCatsRes.reason?.message || 'Error'}`);
  }

  const movies = moviesRes.status === 'fulfilled' ? moviesRes.value : [];
  if (moviesRes.status === 'rejected') {
    errors.push(`Películas: ${moviesRes.reason?.message || 'Error'}`);
  }

  const seriesCategories =
    seriesCatsRes.status === 'fulfilled' ? seriesCatsRes.value : [];
  if (seriesCatsRes.status === 'rejected') {
    errors.push(`Categorías de series: ${seriesCatsRes.reason?.message || 'Error'}`);
  }

  const series = seriesRes.status === 'fulfilled' ? seriesRes.value : [];
  if (seriesRes.status === 'rejected') {
    errors.push(`Series: ${seriesRes.reason?.message || 'Error'}`);
  }

  const liveCategories =
    liveCatsRes.status === 'fulfilled' ? liveCatsRes.value : [];
  if (liveCatsRes.status === 'rejected') {
    errors.push(`Categorías TV en vivo: ${liveCatsRes.reason?.message || 'Error'}`);
  }

  const liveStreams = liveRes.status === 'fulfilled' ? liveRes.value : [];
  if (liveRes.status === 'rejected') {
    errors.push(`TV en vivo: ${liveRes.reason?.message || 'Error'}`);
  }

  // Enriquecer categoryName en los elementos si existe coincidencia
  const catNameMap = new Map<string, string>();
  [...movieCategories, ...seriesCategories, ...liveCategories].forEach((c) => {
    catNameMap.set(`${c.type}::${c.id}`, c.name);
  });

  const enrich = (items: CatalogItem[]) =>
    items.map((it) => ({
      ...it,
      categoryName: it.categoryName || catNameMap.get(`${it.type}::${it.categoryId}`),
    }));

  const enrichedMovies = enrich(movies);
  const enrichedSeries = enrich(series);
  const enrichedLive = enrich(liveStreams);

  if (
    options.useCache &&
    (enrichedMovies.length > 0 || enrichedSeries.length > 0 || enrichedLive.length > 0)
  ) {
    const cacheEntry: CachedCatalog = {
      connectionId: connection.id,
      updatedAt: Date.now(),
      movieCategories,
      movies: enrichedMovies,
      seriesCategories,
      series: enrichedSeries,
      liveCategories,
      liveStreams: enrichedLive,
    };
    saveCachedCatalog(cacheEntry);
  }

  return {
    movieCategories,
    movies: enrichedMovies,
    seriesCategories,
    series: enrichedSeries,
    liveCategories,
    liveStreams: enrichedLive,
    fromCache: false,
    errors,
  };
}

export async function fetchMovieDetails(
  connection: IptvConnection,
  item: CatalogItem
): Promise<MovieDetails> {
  return getAdapterForConnection(connection).getMovieDetails(connection, item);
}

export async function fetchSeriesDetails(
  connection: IptvConnection,
  item: CatalogItem
): Promise<SeriesDetails> {
  return getAdapterForConnection(connection).getSeriesDetails(connection, item);
}

export async function resolveItemPlaybackSource(
  connection: IptvConnection,
  item: CatalogItem,
  episode?: EpisodeItem
): Promise<PlaybackSourceResolution> {
  return getAdapterForConnection(connection).resolvePlaybackSource(
    connection,
    item,
    episode
  );
}
