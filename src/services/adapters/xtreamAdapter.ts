import {
  CatalogCategory,
  CatalogItem,
  ConnectionTestResult,
  EpisodeItem,
  IptvConnection,
  MovieDetails,
  PlaybackSourceResolution,
  ProviderAccountInfo,
  SeasonGroup,
  SeriesDetails,
} from '../../types/iptv';
import { analyzeMediaFormat } from '../../utils/mediaFormats';
import {
  diagnoseFetchError,
  diagnoseHttpStatus,
  isValidHttpUrl,
  normalizeServerUrl,
} from '../../utils/networkErrors';
import { ProviderAdapter } from './types';

interface XtreamAuthResponse {
  user_info?: {
    username?: string;
    status?: string;
    auth?: number | string;
    exp_date?: string | null;
    is_trial?: string | number;
    active_cons?: string | number;
    max_connections?: string | number;
    allowed_output_formats?: string[];
  };
  server_info?: {
    url?: string;
    port?: string;
    https_port?: string;
    server_protocol?: string;
    timezone?: string;
  };
}

interface XtreamCategory {
  category_id: string | number;
  category_name: string;
}

interface XtreamVodStream {
  num?: number;
  name?: string;
  stream_id: string | number;
  stream_icon?: string;
  rating?: string | number;
  rating_5based?: number;
  added?: string | number;
  category_id?: string | number;
  container_extension?: string;
  year?: string;
}

interface XtreamSeriesItem {
  num?: number;
  name?: string;
  series_id: string | number;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  last_modified?: string | number;
  rating?: string | number;
  rating_5based?: number;
  backdrop_path?: string[];
  category_id?: string | number;
}

interface XtreamLiveStream {
  num?: number;
  name?: string;
  stream_id: string | number;
  stream_icon?: string;
  category_id?: string | number;
  added?: string | number;
}

function buildXtreamApiUrl(
  connection: IptvConnection,
  action?: string,
  extraParams?: Record<string, string>
): string {
  const baseUrl = normalizeServerUrl(connection.serverUrl);
  const url = new URL(`${baseUrl}/player_api.php`);
  url.searchParams.set('username', connection.username?.trim() || '');
  url.searchParams.set('password', connection.password || '');
  if (action) {
    url.searchParams.set('action', action);
  }
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function fetchXtreamJson<T>(
  connection: IptvConnection,
  action?: string,
  extraParams?: Record<string, string>
): Promise<T> {
  const baseUrl = normalizeServerUrl(connection.serverUrl);
  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    throw new Error('La URL del servidor Xtream Codes no es válida.');
  }
  if (!connection.username?.trim() || !connection.password) {
    throw new Error('Debes ingresar usuario y contraseña para Xtream Codes.');
  }

  const targetUrl = buildXtreamApiUrl(connection, action, extraParams);
  let res: Response;
  try {
    res = await fetch(targetUrl, { method: 'GET' });
  } catch (err) {
    const diag = diagnoseFetchError(err, targetUrl);
    throw new Error(`${diag.title}: ${diag.message}`);
  }

  if (!res.ok) {
    const diag = diagnoseHttpStatus(res.status, targetUrl);
    throw new Error(`${diag.title}: ${diag.message}`);
  }

  return (await res.json()) as T;
}

function extractYearFromName(name: string): string | undefined {
  const match = name.match(/\((\d{4})\)\s*$/);
  return match ? match[1] : undefined;
}

function formatExpiration(expDate?: string | null): string | undefined {
  if (!expDate) return undefined;
  const ts = Number(expDate);
  if (!Number.isFinite(ts) || ts <= 0) return undefined;
  return new Date(ts * 1000).toLocaleDateString('es-ES');
}

export const xtreamAdapter: ProviderAdapter = {
  id: 'xtream',

  async testConnection(connection: IptvConnection): Promise<ConnectionTestResult> {
    const baseUrl = normalizeServerUrl(connection.serverUrl);
    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
      return {
        success: false,
        status: 'network_error',
        message: 'URL del servidor inválida. Debe comenzar con http:// o https://.',
      };
    }

    if (!connection.username?.trim() || !connection.password) {
      return {
        success: false,
        status: 'auth_error',
        message: 'Usuario y contraseña requeridos para autenticar en Xtream Codes.',
      };
    }

    const authUrl = buildXtreamApiUrl(connection);
    try {
      const res = await fetch(authUrl, { method: 'GET' });
      if (!res.ok) {
        const diag = diagnoseHttpStatus(res.status, authUrl);
        return {
          success: false,
          status: diag.kind === 'auth' ? 'auth_error' : 'network_error',
          message: diag.title,
          details: diag.message,
        };
      }

      const data = (await res.json()) as XtreamAuthResponse;
      const userInfo = data.user_info;

      if (!userInfo || Number(userInfo.auth) !== 1) {
        return {
          success: false,
          status: 'auth_error',
          message: 'Credenciales rechazadas por el servidor Xtream Codes.',
          details:
            'El servidor respondió, pero user_info.auth no es válido (auth !== 1). Revisa tu usuario y contraseña.',
        };
      }

      const isActive = (userInfo.status || '').toLowerCase() === 'active';
      const accountInfo: ProviderAccountInfo = {
        username: userInfo.username,
        status: userInfo.status,
        expDate: formatExpiration(userInfo.exp_date),
        isTrial: String(userInfo.is_trial) === '1',
        activeConnections:
          userInfo.active_cons !== undefined ? String(userInfo.active_cons) : undefined,
        maxConnections:
          userInfo.max_connections !== undefined
            ? String(userInfo.max_connections)
            : undefined,
        allowedOutputFormats: Array.isArray(userInfo.allowed_output_formats)
          ? userInfo.allowed_output_formats
          : [],
        serverTimezone: data.server_info?.timezone,
      };

      if (!isActive) {
        return {
          success: false,
          status: 'auth_error',
          message: `Cuenta en estado "${userInfo.status || 'Inactiva'}"`,
          details:
            'El proveedor indica que la cuenta no se encuentra activa. No se omitirán restricciones del servidor.',
          accountInfo,
        };
      }

      const formats = accountInfo.allowedOutputFormats?.length
        ? accountInfo.allowedOutputFormats.join(', ')
        : 'sin especificar';

      return {
        success: true,
        status: 'connected',
        message: `Autenticación exitosa (${userInfo.username || connection.username})`,
        details: `Estado: ${userInfo.status} · Formatos permitidos por el proveedor: ${formats}.`,
        accountInfo,
        capabilities: {
          auth: true,
          liveTv: true,
          movies: true,
          series: true,
          details: true,
          seasonsAndEpisodes: true,
          playback: true,
        },
      };
    } catch (err) {
      const diag = diagnoseFetchError(err, authUrl);
      return {
        success: false,
        status: diag.corsDetected ? 'cors_error' : 'network_error',
        message: diag.title,
        details: `${diag.message} ${diag.tips.join(' ')}`,
        corsDetected: diag.corsDetected,
      };
    }
  },

  async getMovieCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    const raw = await fetchXtreamJson<XtreamCategory[]>(connection, 'get_vod_categories');
    if (!Array.isArray(raw)) return [];
    return raw.map((c) => ({
      id: String(c.category_id),
      name: c.category_name || `Categoría ${c.category_id}`,
      type: 'movie',
    }));
  },

  async getMovies(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const extra = categoryId && categoryId !== 'all' ? { category_id: categoryId } : undefined;
    const raw = await fetchXtreamJson<XtreamVodStream[]>(connection, 'get_vod_streams', extra);
    if (!Array.isArray(raw)) return [];

    return raw.map((item) => {
      const name = String(item.name || 'Película sin título');
      const ratingNum =
        item.rating_5based !== undefined
          ? Number(item.rating_5based)
          : item.rating !== undefined
          ? Number(item.rating)
          : undefined;
      return {
        id: String(item.stream_id),
        connectionId: connection.id,
        type: 'movie',
        name,
        categoryId: String(item.category_id ?? 'general'),
        logo: item.stream_icon || undefined,
        containerExtension: item.container_extension
          ? String(item.container_extension).toLowerCase()
          : undefined,
        rating: Number.isFinite(ratingNum) && ratingNum! > 0 ? ratingNum : undefined,
        year: item.year || extractYearFromName(name),
        added: item.added ? Number(item.added) : undefined,
      };
    });
  },

  async getSeriesCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    const raw = await fetchXtreamJson<XtreamCategory[]>(connection, 'get_series_categories');
    if (!Array.isArray(raw)) return [];
    return raw.map((c) => ({
      id: String(c.category_id),
      name: c.category_name || `Categoría ${c.category_id}`,
      type: 'series',
    }));
  },

  async getSeries(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const extra = categoryId && categoryId !== 'all' ? { category_id: categoryId } : undefined;
    const raw = await fetchXtreamJson<XtreamSeriesItem[]>(connection, 'get_series', extra);
    if (!Array.isArray(raw)) return [];

    return raw.map((item) => {
      const name = String(item.name || 'Serie sin título');
      const ratingNum =
        item.rating_5based !== undefined
          ? Number(item.rating_5based)
          : item.rating !== undefined
          ? Number(item.rating)
          : undefined;
      const yearMatch = item.releaseDate?.match(/\d{4}/)?.[0] || extractYearFromName(name);
      return {
        id: String(item.series_id),
        connectionId: connection.id,
        type: 'series',
        name,
        categoryId: String(item.category_id ?? 'general'),
        logo: item.cover || undefined,
        backdrop:
          Array.isArray(item.backdrop_path) && item.backdrop_path[0]
            ? item.backdrop_path[0]
            : undefined,
        rating: Number.isFinite(ratingNum) && ratingNum! > 0 ? ratingNum : undefined,
        year: yearMatch,
        added: item.last_modified ? Number(item.last_modified) : undefined,
        plot: item.plot || undefined,
        cast: item.cast || undefined,
        director: item.director || undefined,
        genre: item.genre || undefined,
      };
    });
  },

  async getLiveCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    const raw = await fetchXtreamJson<XtreamCategory[]>(connection, 'get_live_categories');
    if (!Array.isArray(raw)) return [];
    return raw.map((c) => ({
      id: String(c.category_id),
      name: c.category_name || `Grupo ${c.category_id}`,
      type: 'live',
    }));
  },

  async getLiveStreams(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const extra = categoryId && categoryId !== 'all' ? { category_id: categoryId } : undefined;
    const raw = await fetchXtreamJson<XtreamLiveStream[]>(connection, 'get_live_streams', extra);
    if (!Array.isArray(raw)) return [];

    return raw.map((item) => ({
      id: String(item.stream_id),
      connectionId: connection.id,
      type: 'live',
      name: String(item.name || 'Canal en vivo'),
      categoryId: String(item.category_id ?? 'general'),
      logo: item.stream_icon || undefined,
      channelNumber: item.num,
      added: item.added ? Number(item.added) : undefined,
      containerExtension: 'm3u8',
    }));
  },

  async getMovieDetails(connection: IptvConnection, item: CatalogItem): Promise<MovieDetails> {
    try {
      const data = await fetchXtreamJson<{
        info?: Record<string, unknown>;
        movie_data?: Record<string, unknown>;
      }>(connection, 'get_vod_info', { vod_id: item.id });

      const info = data.info || {};
      const movieData = data.movie_data || {};
      const backdropArr = Array.isArray(info.backdrop_path)
        ? (info.backdrop_path as string[])
        : [];

      return {
        item,
        plot: (info.plot as string) || (info.description as string) || item.plot,
        director: (info.director as string) || item.director,
        cast: (info.cast as string) || (info.actors as string) || item.cast,
        genre: (info.genre as string) || item.genre,
        duration: (info.duration as string) || item.duration,
        releaseDate: (info.releasedate as string) || item.year,
        backdrop: backdropArr[0] || (info.movie_image as string) || item.logo,
        trailer: (info.youtube_trailer as string) || undefined,
        tmdbId: info.tmdb_id ? String(info.tmdb_id) : undefined,
        containerExtension:
          (movieData.container_extension as string) || item.containerExtension,
      };
    } catch (err) {
      return {
        item,
        backdrop: item.backdrop || item.logo,
        containerExtension: item.containerExtension,
        missingDetailsNotice:
          err instanceof Error ? err.message : 'No se pudieron obtener detalles adicionales.',
      };
    }
  },

  async getSeriesDetails(
    connection: IptvConnection,
    item: CatalogItem
  ): Promise<SeriesDetails> {
    const data = await fetchXtreamJson<{
      info?: Record<string, unknown>;
      seasons?: Array<Record<string, unknown>>;
      episodes?: Record<string, Array<Record<string, unknown>>>;
    }>(connection, 'get_series_info', { series_id: item.id });

    const info = data.info || {};
    const episodesBySeason = data.episodes || {};
    const seasonsMeta = Array.isArray(data.seasons) ? data.seasons : [];

    const seasonNumbers = Object.keys(episodesBySeason)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const seasons: SeasonGroup[] = seasonNumbers.map((sNum) => {
      const meta = seasonsMeta.find((s) => Number(s.season_number) === sNum);
      const rawEps = episodesBySeason[String(sNum)] || [];
      const episodes: EpisodeItem[] = rawEps.map((ep, idx) => {
        const epInfo = (ep.info as Record<string, unknown>) || {};
        return {
          id: String(ep.id),
          seasonNumber: sNum,
          episodeNumber: Number(ep.episode_num ?? idx + 1),
          title: String(ep.title || `Episodio ${ep.episode_num ?? idx + 1}`),
          plot: (epInfo.plot as string) || undefined,
          duration: (epInfo.duration as string) || undefined,
          thumbnail: (epInfo.movie_image as string) || undefined,
          containerExtension: ep.container_extension
            ? String(ep.container_extension).toLowerCase()
            : undefined,
          added: ep.added ? Number(ep.added) : undefined,
          rating: epInfo.rating ? Number(epInfo.rating) : undefined,
        };
      });

      return {
        seasonNumber: sNum,
        name: (meta?.name as string) || `Temporada ${sNum}`,
        cover: (meta?.cover as string) || undefined,
        overview: (meta?.overview as string) || undefined,
        episodes,
      };
    });

    const backdropArr = Array.isArray(info.backdrop_path)
      ? (info.backdrop_path as string[])
      : [];

    return {
      item,
      plot: (info.plot as string) || item.plot,
      director: (info.director as string) || item.director,
      cast: (info.cast as string) || item.cast,
      genre: (info.genre as string) || item.genre,
      releaseDate: (info.releaseDate as string) || item.year,
      backdrop: backdropArr[0] || (info.cover as string) || item.backdrop || item.logo,
      seasons,
    };
  },

  async resolvePlaybackSource(
    connection: IptvConnection,
    item: CatalogItem,
    episode?: EpisodeItem
  ): Promise<PlaybackSourceResolution> {
    const baseUrl = normalizeServerUrl(connection.serverUrl);
    const user = encodeURIComponent(connection.username?.trim() || '');
    const pass = encodeURIComponent(connection.password || '');

    if (item.type === 'live') {
      const allowed = connection.accountInfo?.allowedOutputFormats || [];
      const supportsM3u8 = allowed.length === 0 || allowed.includes('m3u8');
      const ext = supportsM3u8 ? 'm3u8' : allowed[0] || 'ts';
      const streamUrl = `${baseUrl}/live/${user}/${pass}/${item.id}.${ext}`;
      const format = analyzeMediaFormat(ext, streamUrl);

      if (!format.browserCompatible) {
        return {
          status: 'incompatible_format',
          url: streamUrl,
          format: format.label,
          engine: format.engine,
          browserCompatible: false,
          message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
        };
      }

      return {
        status: 'ready',
        url: streamUrl,
        format: format.label,
        engine: format.engine,
        browserCompatible: true,
      };
    }

    if (item.type === 'series' && episode) {
      const ext = episode.containerExtension || 'mp4';
      const streamUrl = `${baseUrl}/series/${user}/${pass}/${episode.id}.${ext}`;
      const format = analyzeMediaFormat(ext, streamUrl);
      if (!format.browserCompatible) {
        return {
          status: 'incompatible_format',
          url: streamUrl,
          format: format.label,
          engine: format.engine,
          browserCompatible: false,
          message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
        };
      }
      return {
        status: 'ready',
        url: streamUrl,
        format: format.label,
        engine: format.engine,
        browserCompatible: true,
      };
    }

    const ext = item.containerExtension || 'mp4';
    const streamUrl = `${baseUrl}/movie/${user}/${pass}/${item.id}.${ext}`;
    const format = analyzeMediaFormat(ext, streamUrl);

    if (!format.browserCompatible) {
      return {
        status: 'incompatible_format',
        url: streamUrl,
        format: format.label,
        engine: format.engine,
        browserCompatible: false,
        message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
      };
    }

    return {
      status: 'ready',
      url: streamUrl,
      format: format.label,
      engine: format.engine,
      browserCompatible: true,
    };
  },
};

export class XtreamProviderAdapter implements ProviderAdapter {
  readonly id = 'xtream';
  testConnection = xtreamAdapter.testConnection.bind(xtreamAdapter);
  getMovieCategories = xtreamAdapter.getMovieCategories.bind(xtreamAdapter);
  getMovies = xtreamAdapter.getMovies.bind(xtreamAdapter);
  getSeriesCategories = xtreamAdapter.getSeriesCategories.bind(xtreamAdapter);
  getSeries = xtreamAdapter.getSeries.bind(xtreamAdapter);
  getLiveCategories = xtreamAdapter.getLiveCategories.bind(xtreamAdapter);
  getLiveStreams = xtreamAdapter.getLiveStreams.bind(xtreamAdapter);
  getMovieDetails = xtreamAdapter.getMovieDetails.bind(xtreamAdapter);
  getSeriesDetails = xtreamAdapter.getSeriesDetails.bind(xtreamAdapter);
  resolvePlaybackSource = xtreamAdapter.resolvePlaybackSource.bind(xtreamAdapter);
}

