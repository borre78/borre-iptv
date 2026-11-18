import {
  CatalogCategory,
  CatalogItem,
  ConnectionTestResult,
  EpisodeItem,
  IptvConnection,
  MovieDetails,
  PlaybackSourceResolution,
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
import { applyEndpointTemplate, buildAuthHeaders, ProviderAdapter } from './types';

export interface NetskyRawItem {
  id: string | number;
  type: 'movie' | 'series' | string;
  name: string;
  categoryId?: string | number;
  logo?: string;
  backdrop?: string;
  containerExtension?: string;
  rating?: number | string;
  year?: string | number;
  added?: number | string;
  plot?: string;
  synopsis?: string;
  director?: string;
  cast?: string;
  genre?: string;
  duration?: string;
}

function extractItemsArray(payload: unknown): NetskyRawItem[] {
  if (Array.isArray(payload)) {
    return payload as NetskyRawItem[];
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as NetskyRawItem[];
    if (Array.isArray(record.data)) return record.data as NetskyRawItem[];
    if (Array.isArray(record.results)) return record.results as NetskyRawItem[];
  }
  return [];
}

function mapNetskyItem(
  raw: NetskyRawItem,
  connectionId: string,
  fallbackType: 'movie' | 'series'
): CatalogItem {
  const itemType = raw.type === 'series' ? 'series' : fallbackType;
  const parsedRating =
    raw.rating !== undefined && raw.rating !== null && raw.rating !== ''
      ? Number(raw.rating)
      : undefined;
  const parsedAdded =
    raw.added !== undefined && raw.added !== null && raw.added !== ''
      ? Number(raw.added)
      : undefined;

  return {
    id: String(raw.id),
    connectionId,
    type: itemType,
    name: String(raw.name || 'Sin título'),
    categoryId: raw.categoryId !== undefined ? String(raw.categoryId) : 'general',
    logo: raw.logo || undefined,
    backdrop: raw.backdrop || undefined,
    containerExtension: raw.containerExtension
      ? String(raw.containerExtension).toLowerCase()
      : undefined,
    rating: Number.isFinite(parsedRating) ? parsedRating : undefined,
    year: raw.year ? String(raw.year) : undefined,
    added: Number.isFinite(parsedAdded) ? parsedAdded : undefined,
    plot: raw.plot || raw.synopsis || undefined,
    director: raw.director || undefined,
    cast: raw.cast || undefined,
    genre: raw.genre || undefined,
    duration: raw.duration || undefined,
  };
}

function buildCategoriesFromItems(
  items: CatalogItem[],
  type: 'movie' | 'series'
): CatalogCategory[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const catId = item.categoryId || 'general';
    counts.set(catId, (counts.get(catId) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({
      id,
      name: id === 'general' ? 'General' : `Categoría ${id}`,
      type,
      count,
    }));
}

async function fetchNetskyCatalog(
  connection: IptvConnection,
  mediaType: 'movie' | 'series'
): Promise<CatalogItem[]> {
  const baseUrl = normalizeServerUrl(connection.serverUrl);
  const catalogId = connection.catalogId?.trim();

  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    throw new Error('La URL del servidor Netsky no es válida.');
  }
  if (!catalogId) {
    throw new Error(
      'Debes configurar el identificador de catálogo (catalogId) para consultar Netsky.'
    );
  }

  const defaultTemplate =
    mediaType === 'movie'
      ? '/api/player/catalog/{catalogId}/items?type=movie'
      : '/api/player/catalog/{catalogId}/items?type=series';

  const configuredTemplate =
    mediaType === 'movie'
      ? connection.customEndpoints?.moviesEndpoint?.trim() || defaultTemplate
      : connection.customEndpoints?.seriesEndpoint?.trim() || defaultTemplate;

  const url = applyEndpointTemplate(baseUrl, configuredTemplate, {
    catalogId,
    type: mediaType,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: buildAuthHeaders(connection),
    });
  } catch (err) {
    const diag = diagnoseFetchError(err, url);
    const wrapped = new Error(`${diag.title}: ${diag.message}`);
    (wrapped as Error & { isCors?: boolean }).isCors = diag.corsDetected;
    throw wrapped;
  }

  if (!response.ok) {
    const diag = diagnoseHttpStatus(response.status, url);
    throw new Error(`${diag.title}: ${diag.message}`);
  }

  const json: unknown = await response.json();
  const rawItems = extractItemsArray(json);
  return rawItems.map((raw) => mapNetskyItem(raw, connection.id, mediaType));
}

export function getNetskyPendingEndpoints(connection: IptvConnection): string[] {
  const ep = connection.customEndpoints || {};
  const missing: string[] = [];
  if (!ep.authEndpoint?.trim()) {
    missing.push('Endpoint de autenticación');
  }
  if (!ep.detailsEndpoint?.trim()) {
    missing.push('Endpoint de detalles de título');
  }
  if (!ep.seasonsEndpoint?.trim() && !ep.episodesEndpoint?.trim()) {
    missing.push('Endpoints de temporadas y episodios');
  }
  if (!ep.playbackEndpoint?.trim()) {
    missing.push('Endpoint de fuente / URL de reproducción');
  }
  return missing;
}

export const netskyAdapter: ProviderAdapter = {
  id: 'netsky',

  async testConnection(connection: IptvConnection): Promise<ConnectionTestResult> {
    const baseUrl = normalizeServerUrl(connection.serverUrl);
    const catalogId = connection.catalogId?.trim();

    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
      return {
        success: false,
        status: 'network_error',
        message: 'URL del servidor inválida. Introduce una URL http:// o https:// válida.',
      };
    }

    if (!catalogId) {
      return {
        success: false,
        status: 'pending_config',
        message:
          'Falta el identificador de catálogo (catalogId). No puede quedar vacío en la configuración de Netsky.',
      };
    }

    const pendingEndpoints = getNetskyPendingEndpoints(connection);

    // Si hay endpoint de autenticación configurado, probarlo primero sin inventar rutas
    if (connection.customEndpoints?.authEndpoint?.trim()) {
      const authUrl = applyEndpointTemplate(
        baseUrl,
        connection.customEndpoints.authEndpoint,
        {
          catalogId,
          username: connection.username,
        }
      );
      try {
        const authRes = await fetch(authUrl, {
          method: 'GET',
          headers: buildAuthHeaders(connection),
        });
        if (!authRes.ok) {
          const diag = diagnoseHttpStatus(authRes.status, authUrl);
          return {
            success: false,
            status: diag.kind === 'auth' ? 'auth_error' : 'network_error',
            message: diag.title,
            details: diag.message,
          };
        }
      } catch (err) {
        const diag = diagnoseFetchError(err, authUrl);
        return {
          success: false,
          status: diag.corsDetected ? 'cors_error' : 'network_error',
          message: diag.title,
          details: diag.message,
          corsDetected: diag.corsDetected,
        };
      }
    }

    const testUrl = applyEndpointTemplate(
      baseUrl,
      connection.customEndpoints?.moviesEndpoint?.trim() ||
        '/api/player/catalog/{catalogId}/items?type=movie',
      { catalogId, type: 'movie' }
    );

    try {
      const res = await fetch(testUrl, {
        method: 'GET',
        headers: buildAuthHeaders(connection),
      });

      if (!res.ok) {
        const diag = diagnoseHttpStatus(res.status, testUrl);
        return {
          success: false,
          status: diag.kind === 'auth' ? 'auth_error' : 'network_error',
          message: diag.title,
          details: diag.message,
        };
      }

      const payload: unknown = await res.json();
      const items = extractItemsArray(payload);

      let accountDetected = false;
      const accountTemplate =
        connection.customEndpoints?.accountEndpoint?.trim() ||
        '/api/player/catalog/{catalogId}/account';
      try {
        const accUrl = applyEndpointTemplate(baseUrl, accountTemplate, { catalogId });
        const accRes = await fetch(accUrl, {
          method: 'GET',
          headers: buildAuthHeaders(connection),
        });
        if (accRes.ok) {
          const accJson = (await accRes.json()) as Record<string, unknown>;
          if (accJson && typeof accJson === 'object') {
            accountDetected = true;
          }
        }
      } catch {
        // Endpoint de cuenta opcional en comprobación rápida
      }

      return {
        success: true,
        status: pendingEndpoints.length > 0 ? 'pending_config' : 'connected',
        message:
          pendingEndpoints.length > 0
            ? `Catálogo Netsky accesible (${items.length} películas). Endpoints de reproducción/episodios pendientes de configurar.`
            : `Conexión Netsky verificada (${items.length} películas encontradas).`,
        details:
          pendingEndpoints.length > 0
            ? `Pendientes: ${pendingEndpoints.join(', ')}. La respuesta HTTP 200 del catálogo no garantiza reproducción directa hasta configurar la ruta de streaming compatible.`
            : 'Catálogo y rutas personalizadas configuradas.',
        sampleItemsCount: items.length,
        pendingEndpoints,
        capabilities: {
          auth: Boolean(connection.customEndpoints?.authEndpoint?.trim()),
          account: accountDetected || Boolean(connection.customEndpoints?.accountEndpoint?.trim()),
          liveTv: Boolean(connection.customEndpoints?.liveEndpoint?.trim()),
          movies: true,
          series: true,
          details: Boolean(connection.customEndpoints?.detailsEndpoint?.trim()),
          seasonsAndEpisodes: Boolean(
            connection.customEndpoints?.seasonsEndpoint?.trim() ||
              connection.customEndpoints?.episodesEndpoint?.trim()
          ),
          playback: Boolean(connection.customEndpoints?.playbackEndpoint?.trim()),
        },
      };
    } catch (err) {
      const diag = diagnoseFetchError(err, testUrl);
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
    const movies = await fetchNetskyCatalog(connection, 'movie');
    return buildCategoriesFromItems(movies, 'movie');
  },

  async getMovies(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const movies = await fetchNetskyCatalog(connection, 'movie');
    if (categoryId && categoryId !== 'all') {
      return movies.filter((m) => m.categoryId === categoryId);
    }
    return movies;
  },

  async getSeriesCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    const series = await fetchNetskyCatalog(connection, 'series');
    return buildCategoriesFromItems(series, 'series');
  },

  async getSeries(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const series = await fetchNetskyCatalog(connection, 'series');
    if (categoryId && categoryId !== 'all') {
      return series.filter((s) => s.categoryId === categoryId);
    }
    return series;
  },

  async getLiveCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    if (!connection.customEndpoints?.liveEndpoint?.trim()) {
      return [];
    }
    const streams = await this.getLiveStreams(connection);
    const counts = new Map<string, number>();
    for (const ch of streams) {
      counts.set(ch.categoryId, (counts.get(ch.categoryId) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([id, count]) => ({
      id,
      name: id === 'general' ? 'TV en vivo' : `Grupo ${id}`,
      type: 'live',
      count,
    }));
  },

  async getLiveStreams(connection: IptvConnection): Promise<CatalogItem[]> {
    const liveTemplate = connection.customEndpoints?.liveEndpoint?.trim();
    if (!liveTemplate) {
      return [];
    }
    const url = applyEndpointTemplate(normalizeServerUrl(connection.serverUrl), liveTemplate, {
      catalogId: connection.catalogId,
    });
    const res = await fetch(url, { headers: buildAuthHeaders(connection) });
    if (!res.ok) {
      const diag = diagnoseHttpStatus(res.status, url);
      throw new Error(`${diag.title}: ${diag.message}`);
    }
    const json: unknown = await res.json();
    const rawItems = extractItemsArray(json);
    return rawItems.map((raw) => ({
      ...mapNetskyItem(raw, connection.id, 'movie'),
      type: 'live',
    }));
  },

  async getMovieDetails(connection: IptvConnection, item: CatalogItem): Promise<MovieDetails> {
    const detailsTemplate = connection.customEndpoints?.detailsEndpoint?.trim();
    if (!detailsTemplate) {
      return {
        item,
        plot: item.plot,
        director: item.director,
        cast: item.cast,
        genre: item.genre,
        duration: item.duration,
        releaseDate: item.year,
        backdrop: item.backdrop || item.logo,
        containerExtension: item.containerExtension,
        missingDetailsNotice:
          'El endpoint de detalles extendidos de Netsky aún no está configurado. Se muestran los metadatos recibidos del catálogo.',
      };
    }

    const url = applyEndpointTemplate(
      normalizeServerUrl(connection.serverUrl),
      detailsTemplate,
      {
        catalogId: connection.catalogId,
        id: item.id,
        type: 'movie',
      }
    );

    try {
      const res = await fetch(url, { headers: buildAuthHeaders(connection) });
      if (!res.ok) {
        const diag = diagnoseHttpStatus(res.status, url);
        return {
          item,
          backdrop: item.backdrop || item.logo,
          containerExtension: item.containerExtension,
          missingDetailsNotice: `${diag.title}: ${diag.message}`,
        };
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        item,
        plot: (data.plot as string) || (data.synopsis as string) || item.plot,
        director: (data.director as string) || item.director,
        cast: (data.cast as string) || item.cast,
        genre: (data.genre as string) || item.genre,
        duration: (data.duration as string) || item.duration,
        releaseDate: (data.releaseDate as string) || (data.year as string) || item.year,
        backdrop: (data.backdrop as string) || item.backdrop || item.logo,
        containerExtension:
          (data.containerExtension as string) || item.containerExtension,
      };
    } catch (err) {
      const diag = diagnoseFetchError(err, url);
      return {
        item,
        backdrop: item.backdrop || item.logo,
        containerExtension: item.containerExtension,
        missingDetailsNotice: `${diag.title}: ${diag.message}`,
      };
    }
  },

  async getSeriesDetails(
    connection: IptvConnection,
    item: CatalogItem
  ): Promise<SeriesDetails> {
    const seasonsTemplate = connection.customEndpoints?.seasonsEndpoint?.trim();
    const episodesTemplate = connection.customEndpoints?.episodesEndpoint?.trim();
    const detailsTemplate = connection.customEndpoints?.detailsEndpoint?.trim();

    if (!seasonsTemplate && !episodesTemplate) {
      return {
        item,
        plot: item.plot,
        director: item.director,
        cast: item.cast,
        genre: item.genre,
        releaseDate: item.year,
        backdrop: item.backdrop || item.logo,
        seasons: [],
        pendingIntegrationNotice: {
          title: 'Endpoints de temporadas y episodios pendientes de configuración',
          description:
            'El catálogo de Netsky devuelve la ficha principal de la serie, pero las rutas exactas de temporadas y episodios aún no están documentadas ni configuradas en esta conexión. NEXUS IPTV no inventa endpoints ni simula episodios ficticios.',
          missingEndpoints: [
            'Ruta de temporadas (ej. /api/player/series/{id}/seasons)',
            'Ruta de episodios (ej. /api/player/series/{id}/episodes)',
            !connection.customEndpoints?.playbackEndpoint?.trim()
              ? 'Ruta de fuente de reproducción'
              : '',
          ].filter(Boolean),
        },
      };
    }

    const baseUrl = normalizeServerUrl(connection.serverUrl);
    let extraDetails: Record<string, unknown> = {};

    if (detailsTemplate) {
      try {
        const dUrl = applyEndpointTemplate(baseUrl, detailsTemplate, {
          catalogId: connection.catalogId,
          id: item.id,
          seriesId: item.id,
          type: 'series',
        });
        const dRes = await fetch(dUrl, { headers: buildAuthHeaders(connection) });
        if (dRes.ok) {
          extraDetails = (await dRes.json()) as Record<string, unknown>;
        }
      } catch {
        // Detalles opcionales
      }
    }

    const targetTemplate = episodesTemplate || seasonsTemplate!;
    const url = applyEndpointTemplate(baseUrl, targetTemplate, {
      catalogId: connection.catalogId,
      id: item.id,
      seriesId: item.id,
    });

    try {
      const res = await fetch(url, { headers: buildAuthHeaders(connection) });
      if (!res.ok) {
        const diag = diagnoseHttpStatus(res.status, url);
        return {
          item,
          backdrop: item.backdrop || item.logo,
          seasons: [],
          pendingIntegrationNotice: {
            title: diag.title,
            description: diag.message,
            missingEndpoints: [targetTemplate],
          },
        };
      }

      const payload = (await res.json()) as unknown;
      const seasons: SeasonGroup[] = normalizeNetskySeasonsPayload(payload);

      return {
        item,
        plot: (extraDetails.plot as string) || item.plot,
        director: (extraDetails.director as string) || item.director,
        cast: (extraDetails.cast as string) || item.cast,
        genre: (extraDetails.genre as string) || item.genre,
        releaseDate: (extraDetails.year as string) || item.year,
        backdrop: (extraDetails.backdrop as string) || item.backdrop || item.logo,
        seasons,
      };
    } catch (err) {
      const diag = diagnoseFetchError(err, url);
      return {
        item,
        backdrop: item.backdrop || item.logo,
        seasons: [],
        pendingIntegrationNotice: {
          title: diag.title,
          description: diag.message,
          missingEndpoints: [targetTemplate],
        },
      };
    }
  },

  async resolvePlaybackSource(
    connection: IptvConnection,
    item: CatalogItem,
    episode?: EpisodeItem
  ): Promise<PlaybackSourceResolution> {
    if (episode?.streamUrl || item.streamUrl) {
      const directUrl = episode?.streamUrl || item.streamUrl!;
      const format = analyzeMediaFormat(
        episode?.containerExtension || item.containerExtension,
        directUrl
      );
      if (!format.browserCompatible) {
        return {
          status: 'incompatible_format',
          url: directUrl,
          format: format.label,
          engine: format.engine,
          browserCompatible: false,
          message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
        };
      }
      return {
        status: 'ready',
        url: directUrl,
        format: format.label,
        engine: format.engine,
        browserCompatible: true,
      };
    }

    const playbackTemplate = connection.customEndpoints?.playbackEndpoint?.trim();
    if (!playbackTemplate) {
      const ext = (episode?.containerExtension || item.containerExtension || '').toUpperCase();
      const mkvWarning =
        ext === 'MKV'
          ? ' Además, el catálogo indica contenedor MKV, el cual no es compatible directamente con navegadores web sin transcodificación a HLS (.m3u8) o MP4.'
          : '';

      return {
        status: 'pending_endpoint',
        browserCompatible: false,
        format: ext || undefined,
        message: `El endpoint de reproducción de Netsky aún no está documentado ni configurado para esta conexión.${mkvWarning}`,
        missingEndpointDoc:
          'Configura el campo "Endpoint de reproducción" en Mis conexiones > Editar proveedor Netsky cuando dispongas de la ruta oficial de streaming o token de sesión.',
      };
    }

    const url = applyEndpointTemplate(
      normalizeServerUrl(connection.serverUrl),
      playbackTemplate,
      {
        catalogId: connection.catalogId,
        id: episode ? episode.id : item.id,
        itemId: item.id,
        episodeId: episode?.id,
        type: item.type,
      }
    );

    try {
      const res = await fetch(url, { headers: buildAuthHeaders(connection) });
      if (!res.ok) {
        const diag = diagnoseHttpStatus(res.status, url);
        return {
          status: 'error',
          browserCompatible: false,
          message: `${diag.title}: ${diag.message}`,
        };
      }

      const data = (await res.json()) as Record<string, unknown>;
      const resolvedUrl =
        (data.url as string) ||
        (data.streamUrl as string) ||
        (data.src as string) ||
        (data.hls as string);

      if (!resolvedUrl) {
        return {
          status: 'error',
          browserCompatible: false,
          message:
            'El endpoint de reproducción respondió correctamente, pero no incluyó ninguna URL de flujo (url, streamUrl, src o hls).',
        };
      }

      const format = analyzeMediaFormat(
        (data.format as string) || episode?.containerExtension || item.containerExtension,
        resolvedUrl
      );

      if (!format.browserCompatible) {
        return {
          status: 'incompatible_format',
          url: resolvedUrl,
          format: format.label,
          engine: format.engine,
          browserCompatible: false,
          message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
        };
      }

      return {
        status: 'ready',
        url: resolvedUrl,
        format: format.label,
        engine: format.engine,
        browserCompatible: true,
      };
    } catch (err) {
      const diag = diagnoseFetchError(err, url);
      return {
        status: 'error',
        browserCompatible: false,
        message: `${diag.title}: ${diag.message}`,
      };
    }
  },
};

function normalizeNetskySeasonsPayload(payload: unknown): SeasonGroup[] {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    // Si es un arreglo de temporadas con episodes adentro
    const hasEpisodesProp = payload.some(
      (entry) => entry && typeof entry === 'object' && Array.isArray((entry as Record<string, unknown>).episodes)
    );
    if (hasEpisodesProp) {
      return payload.map((entry, idx) => {
        const rec = entry as Record<string, unknown>;
        const seasonNum = Number(rec.seasonNumber ?? rec.season ?? idx + 1);
        const eps = Array.isArray(rec.episodes) ? rec.episodes : [];
        return {
          seasonNumber: seasonNum,
          name: String(rec.name || `Temporada ${seasonNum}`),
          episodes: eps.map((ep, eIdx) => mapRawEpisode(ep as Record<string, unknown>, seasonNum, eIdx + 1)),
        };
      });
    }

    // Arreglo plano de episodios
    const grouped = new Map<number, EpisodeItem[]>();
    payload.forEach((raw, idx) => {
      const rec = raw as Record<string, unknown>;
      const sNum = Number(rec.seasonNumber ?? rec.season ?? 1);
      const list = grouped.get(sNum) || [];
      list.push(mapRawEpisode(rec, sNum, idx + 1));
      grouped.set(sNum, list);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, episodes]) => ({
        seasonNumber,
        name: `Temporada ${seasonNumber}`,
        episodes,
      }));
  }

  if (typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.seasons)) {
      return normalizeNetskySeasonsPayload(rec.seasons);
    }
    if (Array.isArray(rec.episodes)) {
      return normalizeNetskySeasonsPayload(rec.episodes);
    }
  }

  return [];
}

function mapRawEpisode(
  rec: Record<string, unknown>,
  fallbackSeason: number,
  fallbackEp: number
): EpisodeItem {
  const seasonNumber = Number(rec.seasonNumber ?? rec.season ?? fallbackSeason);
  const episodeNumber = Number(rec.episodeNumber ?? rec.episode ?? rec.num ?? fallbackEp);
  return {
    id: String(rec.id ?? `${seasonNumber}-${episodeNumber}`),
    seasonNumber,
    episodeNumber,
    title: String(rec.title || rec.name || `Episodio ${episodeNumber}`),
    plot: (rec.plot as string) || (rec.overview as string) || undefined,
    duration: (rec.duration as string) || undefined,
    thumbnail: (rec.thumbnail as string) || (rec.logo as string) || undefined,
    containerExtension: (rec.containerExtension as string) || undefined,
    streamUrl: (rec.streamUrl as string) || (rec.url as string) || undefined,
  };
}
