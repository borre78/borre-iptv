import {
  CatalogCategory,
  CatalogItem,
  ConnectionTestResult,
  EpisodeItem,
  IptvConnection,
  MovieDetails,
  PlaybackSourceResolution,
  SeriesDetails,
} from '../../types/iptv';

export interface ProviderAdapter {
  readonly id: string;
  testConnection(connection: IptvConnection): Promise<ConnectionTestResult>;
  getMovieCategories(connection: IptvConnection): Promise<CatalogCategory[]>;
  getMovies(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]>;
  getSeriesCategories(connection: IptvConnection): Promise<CatalogCategory[]>;
  getSeries(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]>;
  getLiveCategories(connection: IptvConnection): Promise<CatalogCategory[]>;
  getLiveStreams(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]>;
  getMovieDetails(connection: IptvConnection, item: CatalogItem): Promise<MovieDetails>;
  getSeriesDetails(connection: IptvConnection, item: CatalogItem): Promise<SeriesDetails>;
  resolvePlaybackSource(
    connection: IptvConnection,
    item: CatalogItem,
    episode?: EpisodeItem
  ): Promise<PlaybackSourceResolution>;
}

export function applyEndpointTemplate(
  baseUrl: string,
  template: string,
  vars: Record<string, string | number | undefined>
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  let path = template.trim();

  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) {
      path = path.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
    }
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${normalizedPath}`;
}

export function buildAuthHeaders(connection: IptvConnection): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const token = connection.token?.trim();
  if (token) {
    const headerName = connection.customEndpoints?.authHeaderName?.trim() || 'Authorization';
    const prefix = connection.customEndpoints?.tokenPrefix?.trim();
    headers[headerName] = prefix ? `${prefix} ${token}` : token;
  }

  return headers;
}
