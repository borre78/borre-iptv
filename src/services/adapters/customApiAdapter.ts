import {
  CatalogCategory,
  CatalogItem,
  ConnectionTestResult,
  EpisodeItem,
  IptvConnection,
  MovieDetails,
  NetskySafeSessionView,
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
import {
  diagnoseViaBackend,
  fetchCatalogViaBackend,
  queryEndpointViaBackend,
  shouldUseSecureBackend,
} from '../backendClient';
import {
  attemptSessionRenewalOnUnauthorized,
  createOrRenewProfileSession,
  getSafeNetskySessionView,
  loginNetskyIptv,
  logoutNetskySession,
  resolveInMemorySessionRequest,
  setBackendSafeSnapshot,
  syncNetskySessionFromBackend,
} from '../netskySessionService';
import { applyEndpointTemplate, ProviderAdapter } from './types';

function extractList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.items)) return rec.items as Array<Record<string, unknown>>;
    if (Array.isArray(rec.data)) return rec.data as Array<Record<string, unknown>>;
    if (Array.isArray(rec.results)) return rec.results as Array<Record<string, unknown>>;
    if (Array.isArray(rec.channels)) return rec.channels as Array<Record<string, unknown>>;
  }
  return [];
}

function mapCustomItem(
  raw: Record<string, unknown>,
  connectionId: string,
  fallbackType: 'movie' | 'series' | 'live',
  idx: number
): CatalogItem {
  const rawType = raw.type;
  const resolvedType: 'movie' | 'series' | 'live' =
    rawType === 'series'
      ? 'series'
      : rawType === 'movie'
      ? 'movie'
      : rawType === 'live'
      ? 'live'
      : fallbackType;

  const parsedRating =
    raw.rating !== undefined && raw.rating !== null && raw.rating !== ''
      ? Number(raw.rating)
      : undefined;
  const parsedAdded =
    raw.added !== undefined && raw.added !== null && raw.added !== ''
      ? Number(raw.added)
      : undefined;

  return {
    id: String(raw.id ?? raw.stream_id ?? raw.series_id ?? idx + 1),
    connectionId,
    type: resolvedType,
    name: String(raw.name || raw.title || `Título ${idx + 1}`),
    categoryId: String(raw.categoryId ?? raw.category_id ?? raw.group ?? 'general'),
    categoryName: raw.categoryName ? String(raw.categoryName) : undefined,
    logo: (raw.logo || raw.poster || raw.cover || raw.stream_icon) as
      | string
      | undefined,
    backdrop: (raw.backdrop || raw.banner) as string | undefined,
    containerExtension: raw.containerExtension
      ? String(raw.containerExtension).toLowerCase()
      : raw.container_extension
      ? String(raw.container_extension).toLowerCase()
      : undefined,
    rating: Number.isFinite(parsedRating) ? parsedRating : undefined,
    year: raw.year ? String(raw.year) : undefined,
    added: Number.isFinite(parsedAdded) ? parsedAdded : undefined,
    streamUrl: (raw.streamUrl || raw.url) as string | undefined,
    plot: (raw.plot || raw.synopsis || raw.description) as string | undefined,
    director: raw.director as string | undefined,
    cast: raw.cast as string | undefined,
    genre: raw.genre as string | undefined,
    duration: raw.duration as string | undefined,
  };
}

/**
 * Ejecuta una consulta autenticada (cuando el mecanismo de envío de token está confirmado)
 * usando los tokens en memoria, con renovación automática ante expiración/401.
 */
async function fetchCustomEndpoint(
  connection: IptvConnection,
  template: string | undefined,
  vars: Record<string, string | number | undefined>,
  endpointLabel: string
): Promise<unknown> {
  if (!template?.trim()) {
    throw new Error(
      `${endpointLabel} aún no está configurado para este proveedor (${connection.name}).`
    );
  }

  if (shouldUseSecureBackend(connection)) {
    const res = await queryEndpointViaBackend(connection, template, vars);
    if (!res.ok) {
      throw new Error(
        `${res.diagnostic.message}${res.diagnostic.detail ? ` ${res.diagnostic.detail}` : ''}`
      );
    }
    return res.data;
  }

  const baseUrl = normalizeServerUrl(connection.serverUrl);
  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    throw new Error('La URL base del servidor no es válida.');
  }

  const rawUrl = applyEndpointTemplate(baseUrl, template, vars);
  const reqCfg = await resolveInMemorySessionRequest(connection, rawUrl);

  let res: Response;
  try {
    res = await fetch(reqCfg.url, { headers: reqCfg.headers });
  } catch (err) {
    const diag = diagnoseFetchError(err, rawUrl);
    throw new Error(`${diag.title}: ${diag.message}`);
  }

  // Gestión de expiración y renovación de sesión ante HTTP 401/403
  if ((res.status === 401 || res.status === 403) && reqCfg.canRetryOn401) {
    const renewed = await attemptSessionRenewalOnUnauthorized(connection);
    if (renewed) {
      const retryCfg = await resolveInMemorySessionRequest(connection, rawUrl);
      try {
        res = await fetch(retryCfg.url, { headers: retryCfg.headers });
      } catch (err) {
        const diag = diagnoseFetchError(err, rawUrl);
        throw new Error(`${diag.title}: ${diag.message}`);
      }
    }
  }

  if (!res.ok) {
    const diag = diagnoseHttpStatus(res.status, rawUrl);
    const transportHint =
      (res.status === 401 || res.status === 403) &&
      (!connection.customEndpoints?.tokenTransport ||
        connection.customEndpoints.tokenTransport === 'unconfirmed')
        ? ' El mecanismo de envío de tokens está pendiente de confirmar en la configuración de la conexión.'
        : '';
    throw new Error(`${diag.title}: ${diag.message}${transportHint}`);
  }

  return await res.json();
}

export function getCustomPendingEndpoints(connection: IptvConnection): string[] {
  const ep = connection.customEndpoints || {};
  const missing: string[] = [];
  if (!ep.loginIptvEndpoint?.trim() && !ep.authEndpoint?.trim()) {
    missing.push('Ruta de login-iptv');
  }
  if (!ep.tokenTransport || ep.tokenTransport === 'unconfirmed') {
    missing.push('Mecanismo de envío de tokens');
  }
  if (!ep.moviesEndpoint?.trim() && !ep.seriesEndpoint?.trim() && !ep.liveEndpoint?.trim()) {
    missing.push('Rutas de catálogo');
  }
  if (!ep.detailsEndpoint?.trim()) {
    missing.push('Endpoint de detalles');
  }
  if (!ep.seasonsEndpoint?.trim() && !ep.episodesEndpoint?.trim()) {
    missing.push('Endpoints de temporadas y episodios');
  }
  if (!ep.playbackEndpoint?.trim()) {
    missing.push('Endpoint de reproducción');
  }
  return missing;
}

function buildCategoriesFromItems(
  items: CatalogItem[],
  type: 'movie' | 'series' | 'live'
): CatalogCategory[] {
  const counts = new Map<string, number>();
  items.forEach((i) => counts.set(i.categoryId, (counts.get(i.categoryId) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({
      id,
      name: id === 'general' ? 'General' : `Categoría ${id}`,
      type,
      count,
    }));
}

export class CustomApiProviderAdapter implements ProviderAdapter {
  readonly id = 'custom_api';

  // --- Flujo real de autenticación y sesión Netsky en memoria ---

  getSessionState(connectionId: string): NetskySafeSessionView {
    return getSafeNetskySessionView(connectionId);
  }

  async syncSessionState(connection: IptvConnection): Promise<NetskySafeSessionView> {
    return syncNetskySessionFromBackend(connection);
  }

  async loginIptv(connection: IptvConnection): Promise<NetskySafeSessionView> {
    return loginNetskyIptv(connection);
  }

  async selectProfileAndCreateSession(
    connection: IptvConnection,
    profileId: string
  ): Promise<NetskySafeSessionView> {
    return createOrRenewProfileSession(connection, profileId);
  }

  async renewProfileSession(
    connection: IptvConnection
  ): Promise<NetskySafeSessionView> {
    const current = getSafeNetskySessionView(connection.id);
    if (!current.selectedProfileId) {
      return current;
    }
    return createOrRenewProfileSession(connection, current.selectedProfileId);
  }

  logout(connectionId: string): NetskySafeSessionView {
    return logoutNetskySession(connectionId);
  }

  // --- Contrato común ProviderAdapter ---

  async testConnection(connection: IptvConnection): Promise<ConnectionTestResult> {
    const baseUrl = normalizeServerUrl(connection.serverUrl);
    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
      return {
        success: false,
        status: 'network_error',
        message: 'La URL del servidor personalizada no es válida.',
      };
    }

    const ep = connection.customEndpoints || {};
    const pendingEndpoints = getCustomPendingEndpoints(connection);

    // Flujo seguro a través del backend Express de NEXUS (ej. Netsky con CORS estricto)
    if (shouldUseSecureBackend(connection)) {
      const diag = await diagnoseViaBackend(connection);
      if (diag.session) {
        setBackendSafeSnapshot(diag.session);
      }

      if (!diag.ok) {
        return {
          success: false,
          status:
            diag.errorCategory === 'auth_error' || diag.errorCategory === 'session_error'
              ? 'auth_error'
              : 'network_error',
          message:
            diag.message || 'No se pudo completar la prueba a través del backend NEXUS.',
        };
      }

      const moviesOk = Boolean(diag.movies?.ok);
      const seriesOk = Boolean(diag.series?.ok);
      const accountOk = Boolean(diag.account?.ok);
      const anyCatalogVerified = moviesOk || seriesOk;

      const failedDiag =
        (!moviesOk && diag.movies?.diagnostic) ||
        (!seriesOk && diag.series?.diagnostic) ||
        (!accountOk && diag.account?.diagnostic) ||
        null;

      if (!anyCatalogVerified && !accountOk) {
        const cat = failedDiag?.category;
        return {
          success: false,
          status:
            cat === 'auth_error' || cat === 'session_error'
              ? 'auth_error'
              : 'network_error',
          message: failedDiag?.message || 'El proveedor no devolvió respuestas válidas.',
          details: failedDiag?.detail,
          pendingEndpoints,
        };
      }

      const verifiedCount = (diag.movies?.count || 0) + (diag.series?.count || 0);
      return {
        success: anyCatalogVerified,
        status:
          !anyCatalogVerified || pendingEndpoints.length > 0 || Boolean(failedDiag)
            ? 'pending_config'
            : 'connected',
        message: anyCatalogVerified
          ? `Backend seguro verificado (${verifiedCount} elementos en catálogo).`
          : 'Cuenta accesible desde backend; catálogo pendiente o requiere autenticación.',
        details: failedDiag
          ? `${failedDiag.message}${failedDiag.detail ? ` ${failedDiag.detail}` : ''}`
          : pendingEndpoints.length > 0
          ? `Pendientes: ${pendingEndpoints.join(', ')}.`
          : 'Todas las rutas probadas devolvieron JSON válido.',
        sampleItemsCount: verifiedCount,
        accountInfo: diag.account?.accountInfo,
        pendingEndpoints,
        capabilities: {
          auth:
            diag.session?.status === 'session_active' ||
            Boolean(ep.loginIptvEndpoint?.trim() || ep.authEndpoint?.trim()),
          account: accountOk,
          liveTv: Boolean(ep.liveEndpoint?.trim()),
          movies: moviesOk,
          series: seriesOk,
          details: Boolean(ep.detailsEndpoint?.trim()),
          seasonsAndEpisodes: Boolean(
            ep.seasonsEndpoint?.trim() || ep.episodesEndpoint?.trim()
          ),
          playback: Boolean(ep.playbackEndpoint?.trim()),
        },
      };
    }

    const probeTemplate =
      ep.moviesEndpoint?.trim() ||
      ep.accountEndpoint?.trim() ||
      ep.seriesEndpoint?.trim() ||
      ep.liveEndpoint?.trim();

    if (!probeTemplate) {
      return {
        success: false,
        status: 'pending_config',
        message:
          'Este proveedor personalizado aún no tiene endpoints configurados.',
        details:
          'Configura al menos una ruta de catálogo, cuenta o login-iptv en "Endpoints de API personalizada".',
        pendingEndpoints,
      };
    }

    const rawUrl = applyEndpointTemplate(baseUrl, probeTemplate, {
      catalogId: connection.catalogId,
      username: connection.username,
      type: 'movie',
    });

    const reqCfg = await resolveInMemorySessionRequest(connection, rawUrl);

    try {
      let res = await fetch(reqCfg.url, {
        method: 'GET',
        headers: reqCfg.headers,
      });

      if ((res.status === 401 || res.status === 403) && reqCfg.canRetryOn401) {
        const renewed = await attemptSessionRenewalOnUnauthorized(connection);
        if (renewed) {
          const retryCfg = await resolveInMemorySessionRequest(connection, rawUrl);
          res = await fetch(retryCfg.url, {
            method: 'GET',
            headers: retryCfg.headers,
          });
        }
      }

      if (!res.ok) {
        const diag = diagnoseHttpStatus(res.status, rawUrl);
        return {
          success: false,
          status: diag.kind === 'auth' ? 'auth_error' : 'network_error',
          message: diag.title,
          details: diag.message,
        };
      }

      const textBody = await res.text();
      let payload: unknown;
      try {
        payload = JSON.parse(textBody);
      } catch {
        return {
          success: false,
          status: 'network_error',
          message: 'Respuesta inválida del catálogo (HTTP 200 sin JSON válido).',
        };
      }

      const items = extractList(payload);
      const validList = Array.isArray(payload) || items.length > 0;
      if (!validList) {
        return {
          success: false,
          status: 'network_error',
          message: 'HTTP 200 recibido sin estructura válida de catálogo.',
        };
      }

      const session = getSafeNetskySessionView(connection.id);

      return {
        success: true,
        status: pendingEndpoints.length > 0 ? 'pending_config' : 'connected',
        message:
          pendingEndpoints.length > 0
            ? `Endpoint verificado (${items.length} elementos). Hay rutas o autorización pendientes de configurar.`
            : `Proveedor personalizado conectado (${items.length} elementos verificados).`,
        details:
          pendingEndpoints.length > 0
            ? `Pendientes: ${pendingEndpoints.join(', ')}.`
            : 'Rutas configuradas y accesibles.',
        sampleItemsCount: items.length,
        pendingEndpoints,
        capabilities: {
          auth: session.status === 'session_active' || Boolean(ep.loginIptvEndpoint?.trim() || ep.authEndpoint?.trim()),
          account: Boolean(ep.accountEndpoint?.trim()),
          liveTv: Boolean(ep.liveEndpoint?.trim()),
          movies: Boolean(ep.moviesEndpoint?.trim()),
          series: Boolean(ep.seriesEndpoint?.trim()),
          details: Boolean(ep.detailsEndpoint?.trim()),
          seasonsAndEpisodes: Boolean(
            ep.seasonsEndpoint?.trim() || ep.episodesEndpoint?.trim()
          ),
          playback: Boolean(ep.playbackEndpoint?.trim()),
        },
      };
    } catch (err) {
      const diag = diagnoseFetchError(err, rawUrl);
      return {
        success: false,
        status: diag.corsDetected ? 'cors_error' : 'network_error',
        message: diag.title,
        details: `${diag.message} ${diag.tips.join(' ')}`,
        corsDetected: diag.corsDetected,
      };
    }
  }

  async getMovieCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    if (!connection.customEndpoints?.moviesEndpoint?.trim()) return [];
    const items = await this.getMovies(connection);
    return buildCategoriesFromItems(items, 'movie');
  }

  async getMovies(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const endpoint = connection.customEndpoints?.moviesEndpoint?.trim();
    if (!endpoint) return [];

    if (shouldUseSecureBackend(connection)) {
      const res = await fetchCatalogViaBackend(connection, 'movie', endpoint);
      if (!res.ok) {
        throw new Error(
          `${res.diagnostic.message}${res.diagnostic.detail ? ` ${res.diagnostic.detail}` : ''}`
        );
      }
      return categoryId && categoryId !== 'all'
        ? res.items.filter((i) => i.categoryId === categoryId)
        : res.items;
    }

    const payload = await fetchCustomEndpoint(
      connection,
      endpoint,
      { catalogId: connection.catalogId, type: 'movie' },
      'Endpoint de películas'
    );
    const items = extractList(payload).map((r, idx) =>
      mapCustomItem(r, connection.id, 'movie', idx)
    );
    return categoryId && categoryId !== 'all'
      ? items.filter((i) => i.categoryId === categoryId)
      : items;
  }

  async getSeriesCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    if (!connection.customEndpoints?.seriesEndpoint?.trim()) return [];
    const items = await this.getSeries(connection);
    return buildCategoriesFromItems(items, 'series');
  }

  async getSeries(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const endpoint = connection.customEndpoints?.seriesEndpoint?.trim();
    if (!endpoint) return [];

    if (shouldUseSecureBackend(connection)) {
      const res = await fetchCatalogViaBackend(connection, 'series', endpoint);
      if (!res.ok) {
        throw new Error(
          `${res.diagnostic.message}${res.diagnostic.detail ? ` ${res.diagnostic.detail}` : ''}`
        );
      }
      return categoryId && categoryId !== 'all'
        ? res.items.filter((i) => i.categoryId === categoryId)
        : res.items;
    }

    const payload = await fetchCustomEndpoint(
      connection,
      endpoint,
      { catalogId: connection.catalogId, type: 'series' },
      'Endpoint de series'
    );
    const items = extractList(payload).map((r, idx) =>
      mapCustomItem(r, connection.id, 'series', idx)
    );
    return categoryId && categoryId !== 'all'
      ? items.filter((i) => i.categoryId === categoryId)
      : items;
  }

  async getLiveCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    if (!connection.customEndpoints?.liveEndpoint?.trim()) return [];
    const items = await this.getLiveStreams(connection);
    return buildCategoriesFromItems(items, 'live');
  }

  async getLiveStreams(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const endpoint = connection.customEndpoints?.liveEndpoint?.trim();
    if (!endpoint) return [];

    if (shouldUseSecureBackend(connection)) {
      const res = await fetchCatalogViaBackend(connection, 'live', endpoint);
      if (!res.ok) {
        throw new Error(
          `${res.diagnostic.message}${res.diagnostic.detail ? ` ${res.diagnostic.detail}` : ''}`
        );
      }
      return categoryId && categoryId !== 'all'
        ? res.items.filter((i) => i.categoryId === categoryId)
        : res.items;
    }

    const payload = await fetchCustomEndpoint(
      connection,
      endpoint,
      { catalogId: connection.catalogId, type: 'live' },
      'Endpoint de TV en vivo'
    );
    const items = extractList(payload).map((r, idx) =>
      mapCustomItem(r, connection.id, 'live', idx)
    );
    return categoryId && categoryId !== 'all'
      ? items.filter((i) => i.categoryId === categoryId)
      : items;
  }

  async getMovieDetails(connection: IptvConnection, item: CatalogItem): Promise<MovieDetails> {
    const template = connection.customEndpoints?.detailsEndpoint?.trim();
    if (!template) {
      return {
        item,
        plot: item.plot,
        director: item.director,
        cast: item.cast,
        genre: item.genre,
        duration: item.duration,
        backdrop: item.backdrop || item.logo,
        releaseDate: item.year,
        containerExtension: item.containerExtension,
        missingDetailsNotice:
          'Endpoint de detalles aún no configurado para este proveedor. Se muestran los metadatos recibidos del catálogo.',
      };
    }

    try {
      const data = (await fetchCustomEndpoint(
        connection,
        template,
        { id: item.id, catalogId: connection.catalogId, type: 'movie' },
        'Endpoint de detalles'
      )) as Record<string, unknown>;
      return {
        item,
        plot: (data.plot as string) || (data.synopsis as string) || item.plot,
        director: (data.director as string) || item.director,
        cast: (data.cast as string) || item.cast,
        genre: (data.genre as string) || item.genre,
        duration: (data.duration as string) || item.duration,
        releaseDate: (data.year as string) || item.year,
        backdrop: (data.backdrop as string) || item.backdrop || item.logo,
        containerExtension:
          (data.containerExtension as string) || item.containerExtension,
      };
    } catch (err) {
      return {
        item,
        backdrop: item.backdrop || item.logo,
        missingDetailsNotice: err instanceof Error ? err.message : 'Error de detalles',
      };
    }
  }

  async getSeriesDetails(
    connection: IptvConnection,
    item: CatalogItem
  ): Promise<SeriesDetails> {
    const template =
      connection.customEndpoints?.episodesEndpoint?.trim() ||
      connection.customEndpoints?.seasonsEndpoint?.trim();

    if (!template) {
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
          description: `La conexión "${connection.name}" no tiene configuradas las rutas de temporadas o episodios. NEXUS IPTV no inventa endpoints ni simula episodios ficticios.`,
          missingEndpoints: ['Endpoint de temporadas / episodios'],
        },
      };
    }

    try {
      const payload = await fetchCustomEndpoint(
        connection,
        template,
        { id: item.id, seriesId: item.id, catalogId: connection.catalogId },
        'Endpoint de episodios'
      );
      const list = extractList(payload);
      const grouped = new Map<number, EpisodeItem[]>();

      list.forEach((raw, idx) => {
        const sNum = Number(raw.seasonNumber ?? raw.season ?? 1);
        const eps = grouped.get(sNum) || [];
        eps.push({
          id: String(raw.id ?? `${sNum}-${idx + 1}`),
          seasonNumber: sNum,
          episodeNumber: Number(raw.episodeNumber ?? raw.episode ?? idx + 1),
          title: String(raw.title || raw.name || `Episodio ${idx + 1}`),
          plot: raw.plot as string | undefined,
          duration: raw.duration as string | undefined,
          thumbnail: (raw.thumbnail || raw.logo) as string | undefined,
          streamUrl: (raw.streamUrl || raw.url) as string | undefined,
          containerExtension: raw.containerExtension as string | undefined,
        });
        grouped.set(sNum, eps);
      });

      const seasons: SeasonGroup[] = Array.from(grouped.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([seasonNumber, episodes]) => ({
          seasonNumber,
          name: `Temporada ${seasonNumber}`,
          episodes,
        }));

      return {
        item,
        plot: item.plot,
        backdrop: item.backdrop || item.logo,
        seasons,
      };
    } catch (err) {
      return {
        item,
        backdrop: item.backdrop || item.logo,
        seasons: [],
        pendingIntegrationNotice: {
          title: 'Error al consultar temporadas',
          description: err instanceof Error ? err.message : 'Error desconocido',
          missingEndpoints: [template],
        },
      };
    }
  }

  async resolvePlaybackSource(
    connection: IptvConnection,
    item: CatalogItem,
    episode?: EpisodeItem
  ): Promise<PlaybackSourceResolution> {
    if (episode?.streamUrl || item.streamUrl) {
      const url = episode?.streamUrl || item.streamUrl!;
      const format = analyzeMediaFormat(
        episode?.containerExtension || item.containerExtension,
        url
      );
      if (!format.browserCompatible) {
        return {
          status: 'incompatible_format',
          url,
          format: format.label,
          engine: format.engine,
          browserCompatible: false,
          message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
        };
      }
      return {
        status: 'ready',
        url,
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
          ? ' Además, el título indica contenedor MKV, que no es reproducible directamente por los navegadores sin transcodificación a HLS (.m3u8) o MP4.'
          : '';
      return {
        status: 'pending_endpoint',
        browserCompatible: false,
        format: ext || undefined,
        message: `El proveedor "${connection.name}" no tiene configurado un endpoint de reproducción.${mkvWarning}`,
        missingEndpointDoc:
          'Edita esta conexión en Mis conexiones y añade la ruta de reproducción oficial del proveedor cuando esté confirmada.',
      };
    }

    try {
      const payload = (await fetchCustomEndpoint(
        connection,
        playbackTemplate,
        {
          id: episode ? episode.id : item.id,
          itemId: item.id,
          episodeId: episode?.id,
          catalogId: connection.catalogId,
          type: item.type,
        },
        'Endpoint de reproducción'
      )) as Record<string, unknown>;

      const url =
        (payload.url as string) ||
        (payload.streamUrl as string) ||
        (payload.src as string) ||
        (payload.hls as string);

      if (!url) {
        return {
          status: 'error',
          browserCompatible: false,
          message: 'El endpoint de reproducción no devolvió una URL de video válida.',
        };
      }

      const format = analyzeMediaFormat(
        (payload.format as string) || episode?.containerExtension || item.containerExtension,
        url
      );

      if (!format.browserCompatible) {
        return {
          status: 'incompatible_format',
          url,
          format: format.label,
          engine: format.engine,
          browserCompatible: false,
          message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
        };
      }

      return {
        status: 'ready',
        url,
        format: format.label,
        engine: format.engine,
        browserCompatible: true,
      };
    } catch (err) {
      return {
        status: 'error',
        browserCompatible: false,
        message: err instanceof Error ? err.message : 'No se pudo obtener la fuente.',
      };
    }
  }
}

export const customApiAdapter = new CustomApiProviderAdapter();
