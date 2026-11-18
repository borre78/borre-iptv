import {
  CategorizedDiagnosticItem,
  CommunicationMode,
  ConnectionInputType,
  ConnectionStatus,
  CustomEndpointsConfig,
  DiagnosticDimension,
  DiagnosticErrorCategory,
  DiscoveryReport,
  EndpointProbeResult,
  EndpointProbeStatus,
  IptvConnection,
  ProviderAccountInfo,
  ProviderCapabilities,
  ProviderPreset,
  ProviderType,
} from '../types/iptv';
import { analyzeMediaFormat } from '../utils/mediaFormats';
import {
  diagnoseFetchError,
  isValidHttpUrl,
  normalizeServerUrl,
} from '../utils/networkErrors';
import { applyEndpointTemplate, buildAuthHeaders } from './adapters/types';
import { parseM3UPlaylist } from './adapters/m3uAdapter';
import {
  BackendUpstreamDiagnostic,
  diagnoseViaBackend,
  shouldUseSecureBackend,
} from './backendClient';
import {
  getSafeNetskySessionView,
  resolveInMemorySessionRequest,
  setBackendSafeSnapshot,
} from './netskySessionService';

export interface DiscoveryInput {
  connectionId?: string;
  name: string;
  serverUrl: string;
  requestedType: ConnectionInputType;
  communicationMode?: CommunicationMode;
  username?: string;
  password?: string;
  token?: string;
  catalogId?: string;
  m3uUrl?: string;
  m3uRawContent?: string;
  customEndpoints?: CustomEndpointsConfig;
}

export function sanitizeUrlForDisplay(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const sensitiveKeys = ['password', 'pass', 'pwd', 'token', 'api_key', 'apikey', 'secret', 'key'];
    for (const k of sensitiveKeys) {
      if (u.searchParams.has(k)) {
        u.searchParams.set(k, '***');
      }
    }
    if (u.searchParams.has('username')) {
      u.searchParams.set('username', '***');
    }
    // Redactar segmentos /movie/user/pass/... o /live/user/pass/...
    return u.toString();
  } catch {
    return rawUrl;
  }
}

interface HttpProbeOutcome {
  ok: boolean;
  httpCode: string;
  probeStatus: EndpointProbeStatus;
  contentType: string;
  textBody: string;
  jsonBody?: unknown;
  errorDetail?: string;
  corsDetected?: boolean;
}

async function executeSafeProbe(
  url: string,
  headers: HeadersInit
): Promise<HttpProbeOutcome> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const textBody = await res.text();

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        httpCode: String(res.status),
        probeStatus: 'auth_required',
        contentType,
        textBody,
        errorDetail: `Acceso rechazado (HTTP ${res.status}). Requiere autenticación o token válido.`,
      };
    }

    if (res.status === 404) {
      return {
        ok: false,
        httpCode: '404',
        probeStatus: 'not_found',
        contentType,
        textBody,
        errorDetail: 'El servidor respondió HTTP 404 (ruta no encontrada).',
      };
    }

    if (res.status >= 500) {
      return {
        ok: false,
        httpCode: String(res.status),
        probeStatus: 'server_error',
        contentType,
        textBody,
        errorDetail: `Error interno del servidor proveedor (HTTP ${res.status}).`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        httpCode: String(res.status),
        probeStatus: 'server_error',
        contentType,
        textBody,
        errorDetail: `Respuesta HTTP no exitosa (${res.status}).`,
      };
    }

    let jsonBody: unknown = undefined;
    const trimmed = textBody.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        jsonBody = JSON.parse(trimmed);
      } catch {
        jsonBody = undefined;
      }
    }

    return {
      ok: true,
      httpCode: String(res.status),
      probeStatus: 'compatible',
      contentType,
      textBody,
      jsonBody,
    };
  } catch (err) {
    const diag = diagnoseFetchError(err, url);
    return {
      ok: false,
      httpCode: diag.corsDetected ? 'CORS' : 'RED',
      probeStatus: diag.corsDetected ? 'cors_error' : 'server_error',
      contentType: '',
      textBody: '',
      errorDetail: `${diag.title}: ${diag.message}`,
      corsDetected: diag.corsDetected,
    };
  }
}

function extractCatalogArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
  }
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.items)) return rec.items as Array<Record<string, unknown>>;
    if (Array.isArray(rec.data)) return rec.data as Array<Record<string, unknown>>;
    if (Array.isArray(rec.results)) return rec.results as Array<Record<string, unknown>>;
  }
  return [];
}

function summarizeContainers(items: Array<Record<string, unknown>>): string[] {
  const exts = new Set<string>();
  for (const item of items.slice(0, 100)) {
    const rawExt = item.containerExtension ?? item.container_extension;
    if (typeof rawExt === 'string' && rawExt.trim()) {
      exts.add(rawExt.trim().toLowerCase());
    }
  }
  return Array.from(exts);
}

function buildTempConnection(input: DiscoveryInput, baseUrl: string): IptvConnection {
  const now = Date.now();
  const inferredPreset: ProviderPreset = /zenbu\.fans/i.test(baseUrl)
    ? 'netsky'
    : 'custom_generic';
  return {
    id: input.connectionId || 'discovery-temp',
    name: input.name || 'Exploración',
    type: input.requestedType === 'auto' ? 'custom_api' : input.requestedType,
    preset: inferredPreset,
    communicationMode: input.communicationMode,
    serverUrl: baseUrl,
    username: input.username,
    password: input.password,
    token: input.token,
    catalogId: input.catalogId,
    m3uUrl: input.m3uUrl,
    m3uRawContent: input.m3uRawContent,
    customEndpoints: input.customEndpoints,
    status: 'untested',
    capabilities: {
      auth: false,
      account: false,
      liveTv: false,
      movies: false,
      series: false,
      details: false,
      seasonsAndEpisodes: false,
      playback: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export class ProviderDiscoveryService {
  async discover(input: DiscoveryInput): Promise<DiscoveryReport> {
    const rawTarget = (
      input.requestedType === 'm3u'
        ? input.m3uUrl || input.serverUrl
        : input.serverUrl || input.m3uUrl || ''
    ).trim();

    const normalizedUrl = normalizeServerUrl(rawTarget);
    const probes: EndpointProbeResult[] = [];
    const detectedErrors: string[] = [];
    const errorBuckets = new Map<
      DiagnosticErrorCategory,
      { summary: string; detail?: string; httpCode?: string }
    >();
    const securityNotes: string[] = [
      'Las credenciales, contraseñas y tokens están protegidos en memoria del servidor Express (o en memoria temporal si es directo) y nunca se escriben en LocalStorage ni se muestran en pantalla.',
      'El CORS configurado en el backend de NEXUS autoriza exclusivamente los orígenes web propios de NEXUS; nunca modifica ni elude las políticas CORS del servidor proveedor.',
      'Si un proveedor bloquea solicitudes servidor-a-servidor o exige un origen específico (ej. http://tv.zenbu.fans), se informa el error exacto para solicitar autorización al proveedor.',
    ];

    let protocol = 'desconocido';
    let domain = 'desconocido';
    if (isValidHttpUrl(normalizedUrl)) {
      const parsed = new URL(normalizedUrl);
      protocol = parsed.protocol.replace(':', '').toUpperCase();
      domain = parsed.host;
    }

    // Validación inicial de URL o archivo M3U local
    if (!input.m3uRawContent?.trim() && (!normalizedUrl || !isValidHttpUrl(normalizedUrl))) {
      detectedErrors.push('La URL base introducida no es válida (debe iniciar con http:// o https://).');
      return this.buildFailedUrlReport(input, rawTarget, normalizedUrl, protocol, domain, detectedErrors, securityNotes);
    }

    const tempConn = buildTempConnection(input, normalizedUrl);
    const headers = buildAuthHeaders(tempConn);
    let inMemorySession = input.connectionId
      ? getSafeNetskySessionView(input.connectionId)
      : undefined;
    let viaBackend = false;

    // Determinar estrategias candidatas según tipo elegido
    const looksLikeM3U =
      input.requestedType === 'm3u' ||
      Boolean(input.m3uRawContent?.trim()) ||
      /\.m3u8?(\?|$)/i.test(normalizedUrl) ||
      /get\.php/i.test(normalizedUrl);

    const tryXtream =
      input.requestedType === 'xtream' ||
      (input.requestedType === 'auto' && !looksLikeM3U && Boolean(input.username?.trim()));

    const tryCustomCatalog =
      input.requestedType === 'custom_api' ||
      (input.requestedType === 'auto' && !looksLikeM3U);

    let detectedType: ProviderType =
      input.requestedType === 'auto' ? 'custom_api' : input.requestedType;
    let detectedPreset: ProviderPreset = 'custom_generic';
    const suggestedEndpoints: CustomEndpointsConfig = {
      ...(input.customEndpoints || {}),
    };
    const capabilities: ProviderCapabilities = {
      auth: false,
      account: false,
      liveTv: false,
      movies: false,
      series: false,
      details: false,
      seasonsAndEpisodes: false,
      playback: false,
    };
    let accountInfo: ProviderAccountInfo | undefined = undefined;
    const discoveredContainers = new Set<string>();

    // 1. Prueba M3U (si aplica)
    if (looksLikeM3U) {
      if (input.m3uRawContent?.trim()) {
        const entries = parseM3UPlaylist(input.m3uRawContent);
        const valid = entries.length > 0;
        probes.push({
          id: 'm3u-local',
          endpoint: 'Archivo M3U importado localmente',
          method: 'GET',
          status: valid ? 'compatible' : 'server_error',
          httpCode: 'LOCAL',
          detectedDataType: valid
            ? `Lista M3U (${entries.length} entradas)`
            : 'Sin entradas válidas',
          validationResult: valid
            ? `Análisis válido: ${entries.filter((e) => e.inferredType === 'live').length} TV en vivo, ${entries.filter((e) => e.inferredType === 'movie').length} películas, ${entries.filter((e) => e.inferredType === 'series').length} series.`
            : 'El texto no contiene directivas #EXTINF ni enlaces HTTP válidos.',
          sampleCount: entries.length,
        });
        if (valid) {
          detectedType = 'm3u';
          detectedPreset = 'm3u_file';
          capabilities.liveTv = entries.some((e) => e.inferredType === 'live');
          capabilities.movies = entries.some((e) => e.inferredType === 'movie');
          capabilities.series = entries.some((e) => e.inferredType === 'series');
          capabilities.playback = true;
        }
      } else {
        const m3uOutcome = await executeSafeProbe(normalizedUrl, { Accept: '*/*' });
        if (m3uOutcome.ok) {
          const entries = parseM3UPlaylist(m3uOutcome.textBody);
          const hasHeader = /#EXTM3U|#EXTINF/i.test(m3uOutcome.textBody);
          if (hasHeader && entries.length > 0) {
            detectedType = 'm3u';
            detectedPreset = 'm3u_url';
            capabilities.liveTv = entries.some((e) => e.inferredType === 'live');
            capabilities.movies = entries.some((e) => e.inferredType === 'movie');
            capabilities.series = entries.some((e) => e.inferredType === 'series');
            capabilities.playback = true;
            entries.slice(0, 100).forEach((e) => {
              if (e.extension) discoveredContainers.add(e.extension);
            });
            probes.push({
              id: 'm3u-remote',
              endpoint: sanitizeUrlForDisplay(normalizedUrl),
              method: 'GET',
              status: 'compatible',
              httpCode: m3uOutcome.httpCode,
              detectedDataType: `Lista M3U (${entries.length} enlaces)`,
              validationResult: `HTTP ${m3uOutcome.httpCode} validado con contenido #EXTM3U real (${entries.length} canales/elementos).`,
              sampleCount: entries.length,
              discoveredFormats: Array.from(discoveredContainers),
            });
          } else {
            probes.push({
              id: 'm3u-remote',
              endpoint: sanitizeUrlForDisplay(normalizedUrl),
              method: 'GET',
              status: 'server_error',
              httpCode: m3uOutcome.httpCode,
              detectedDataType: 'Respuesta no M3U',
              validationResult:
                'El servidor respondió HTTP 200, pero el contenido no es una lista #EXTM3U válida (podría ser una página HTML o error de texto).',
            });
            detectedErrors.push(
              'La URL M3U devolvió HTTP 200 pero su contenido no corresponde a una lista M3U válida.'
            );
          }
        } else {
          probes.push({
            id: 'm3u-remote',
            endpoint: sanitizeUrlForDisplay(normalizedUrl),
            method: 'GET',
            status: m3uOutcome.probeStatus,
            httpCode: m3uOutcome.httpCode,
            detectedDataType: 'Lista M3U',
            validationResult: m3uOutcome.errorDetail || 'No accesible.',
          });
          if (m3uOutcome.errorDetail) detectedErrors.push(m3uOutcome.errorDetail);
        }
      }
    }

    // 2. Prueba Xtream Codes (si aplica)
    if (tryXtream) {
      const originBase = new URL(normalizedUrl).origin;
      const xtreamBase = normalizedUrl.includes('/player_api.php')
        ? normalizedUrl.split('/player_api.php')[0]
        : normalizedUrl === originBase
        ? normalizedUrl
        : normalizedUrl;

      const u = input.username?.trim() || '';
      const p = input.password || '';
      const authUrl = `${xtreamBase}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
      const sanitizedAuthUrl = `${xtreamBase}/player_api.php?username=***&password=***`;

      if (!u || !p) {
        probes.push({
          id: 'xtream-auth',
          endpoint: sanitizedAuthUrl,
          method: 'GET',
          status: 'auth_required',
          httpCode: '—',
          detectedDataType: 'Autenticación Xtream Codes',
          validationResult:
            'Falta usuario o contraseña para verificar /player_api.php.',
        });
      } else {
        const authOut = await executeSafeProbe(authUrl, { Accept: 'application/json' });
        if (authOut.ok && authOut.jsonBody && typeof authOut.jsonBody === 'object') {
          const rec = authOut.jsonBody as {
            user_info?: {
              auth?: number | string;
              status?: string;
              exp_date?: string;
              active_cons?: string | number;
              max_connections?: string | number;
              allowed_output_formats?: string[];
            };
          };
          if (rec.user_info && Number(rec.user_info.auth) === 1) {
            detectedType = 'xtream';
            detectedPreset = 'xtream_standard';
            capabilities.auth = true;
            capabilities.account = true;
            const allowedFormats = Array.isArray(rec.user_info.allowed_output_formats)
              ? rec.user_info.allowed_output_formats
              : [];
            allowedFormats.forEach((f) => discoveredContainers.add(f.toLowerCase()));
            accountInfo = {
              status: rec.user_info.status,
              expDate: rec.user_info.exp_date
                ? new Date(Number(rec.user_info.exp_date) * 1000).toLocaleDateString('es-ES')
                : undefined,
              activeConnections:
                rec.user_info.active_cons !== undefined
                  ? String(rec.user_info.active_cons)
                  : undefined,
              maxConnections:
                rec.user_info.max_connections !== undefined
                  ? String(rec.user_info.max_connections)
                  : undefined,
              allowedOutputFormats: allowedFormats,
            };
            probes.push({
              id: 'xtream-auth',
              endpoint: sanitizedAuthUrl,
              method: 'GET',
              status: 'compatible',
              httpCode: authOut.httpCode,
              detectedDataType: 'Cuenta Xtream Codes',
              validationResult: `JSON Xtream válido (estado: ${rec.user_info.status || 'Active'}). Formatos permitidos: ${allowedFormats.join(', ') || 'sin especificar'}.`,
              discoveredFormats: allowedFormats,
            });

            // Probar catálogos Xtream reales
            const xtreamChecks: Array<{
              id: string;
              action: string;
              label: string;
              capKey: keyof ProviderCapabilities;
            }> = [
              { id: 'xt-vod', action: 'get_vod_streams', label: 'Películas VOD', capKey: 'movies' },
              { id: 'xt-series', action: 'get_series', label: 'Catálogo de series', capKey: 'series' },
              { id: 'xt-live', action: 'get_live_streams', label: 'Canales en vivo', capKey: 'liveTv' },
            ];

            for (const chk of xtreamChecks) {
              const target = `${xtreamBase}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}&action=${chk.action}`;
              const out = await executeSafeProbe(target, { Accept: 'application/json' });
              if (out.ok && Array.isArray(out.jsonBody)) {
                capabilities[chk.capKey] = true;
                capabilities.details = true;
                capabilities.seasonsAndEpisodes = true;
                capabilities.playback = true;
                const exts = summarizeContainers(out.jsonBody as Array<Record<string, unknown>>);
                exts.forEach((e) => discoveredContainers.add(e));
                probes.push({
                  id: chk.id,
                  endpoint: `${xtreamBase}/player_api.php?action=${chk.action}`,
                  method: 'GET',
                  status: 'compatible',
                  httpCode: out.httpCode,
                  detectedDataType: `${chk.label} (${out.jsonBody.length} ítems)`,
                  validationResult: `Array JSON válido con ${out.jsonBody.length} elementos.`,
                  sampleCount: out.jsonBody.length,
                  discoveredFormats: exts,
                });
              } else {
                probes.push({
                  id: chk.id,
                  endpoint: `${xtreamBase}/player_api.php?action=${chk.action}`,
                  method: 'GET',
                  status: out.ok ? 'server_error' : out.probeStatus,
                  httpCode: out.httpCode,
                  detectedDataType: chk.label,
                  validationResult: out.ok
                    ? 'HTTP 200 recibido pero la respuesta no es un array JSON válido.'
                    : out.errorDetail || 'No disponible.',
                });
              }
            }
          } else {
            probes.push({
              id: 'xtream-auth',
              endpoint: sanitizedAuthUrl,
              method: 'GET',
              status: rec.user_info ? 'auth_required' : 'not_found',
              httpCode: authOut.httpCode,
              detectedDataType: 'Xtream Codes API',
              validationResult: rec.user_info
                ? 'El servidor respondió, pero rechazó las credenciales (auth !== 1).'
                : 'HTTP 200 sin estructura user_info de Xtream Codes.',
            });
          }
        } else {
          probes.push({
            id: 'xtream-auth',
            endpoint: sanitizedAuthUrl,
            method: 'GET',
            status: authOut.probeStatus,
            httpCode: authOut.httpCode,
            detectedDataType: 'Xtream Codes API',
            validationResult:
              authOut.errorDetail || 'El servidor no responde como Xtream Codes.',
          });
          if (authOut.errorDetail && input.requestedType === 'xtream') {
            detectedErrors.push(authOut.errorDetail);
          }
        }
      }
    }

    // 3. Prueba API personalizada / Netsky / endpoints configurados (si no fue ya detectado como Xtream o M3U)
    if (
      tryCustomCatalog &&
      !(input.requestedType === 'auto' && (detectedType === 'xtream' || detectedType === 'm3u') && (capabilities.movies || capabilities.liveTv))
    ) {
      const catId = input.catalogId?.trim();
      const accountTemplate =
        input.customEndpoints?.accountEndpoint?.trim() ||
        (catId ? '/api/player/catalog/{catalogId}/account' : '');
      const moviesTemplate =
        input.customEndpoints?.moviesEndpoint?.trim() ||
        (catId ? '/api/player/catalog/{catalogId}/items?type=movie' : '');
      const seriesTemplate =
        input.customEndpoints?.seriesEndpoint?.trim() ||
        (catId ? '/api/player/catalog/{catalogId}/items?type=series' : '');
      const loginIptvTemplate =
        input.customEndpoints?.loginIptvEndpoint?.trim() ||
        input.customEndpoints?.authEndpoint?.trim() ||
        '';
      const loginIptvMethod = input.customEndpoints?.loginIptvMethod || 'POST';
      const profileSessionTemplate =
        input.customEndpoints?.profileSessionEndpoint?.trim() || '';
      const tokenTransport = input.customEndpoints?.tokenTransport || 'unconfirmed';
      const liveTemplate = input.customEndpoints?.liveEndpoint?.trim() || '';
      const detailsTemplate = input.customEndpoints?.detailsEndpoint?.trim() || '';
      const seasonsTemplate =
        input.customEndpoints?.episodesEndpoint?.trim() ||
        input.customEndpoints?.seasonsEndpoint?.trim() ||
        '';
      const playbackTemplate = input.customEndpoints?.playbackEndpoint?.trim() || '';

      // Verificar ruta login-iptv / sesión en memoria sin inventar endpoints
      if (inMemorySession?.hasDeviceToken) {
        capabilities.auth = true;
        probes.push({
          id: 'custom-auth',
          endpoint: loginIptvTemplate || 'Sesión en memoria',
          method: loginIptvMethod,
          status: 'compatible',
          httpCode: 'MEMORIA',
          detectedDataType: 'Autenticación login-iptv',
          validationResult:
            'device_token activo únicamente en memoria (no guardado en LocalStorage ni mostrado en pantalla).',
        });
      } else if (loginIptvTemplate) {
        probes.push({
          id: 'custom-auth',
          endpoint: loginIptvTemplate,
          method: loginIptvMethod,
          status: 'pending_config',
          httpCode: 'CONFIG',
          detectedDataType: 'Autenticación login-iptv',
          validationResult:
            'Ruta login-iptv configurada. Usa "Iniciar sesión (login-iptv)" en Mis conexiones para autenticar en memoria.',
        });
      } else {
        probes.push({
          id: 'custom-auth',
          endpoint: 'No configurado',
          method: 'POST',
          status: 'pending_config',
          httpCode: '—',
          detectedDataType: 'Autenticación login-iptv',
          validationResult:
            'Ruta login-iptv pendiente de configurar. No se inventan endpoints ni mecanismos de envío de tokens.',
        });
      }

      if (profileSessionTemplate) {
        const sessionReady =
          inMemorySession?.status === 'session_active' &&
          inMemorySession.hasProfileToken;
        probes.push({
          id: 'custom-profile-session',
          endpoint: profileSessionTemplate,
          method: 'POST',
          status: sessionReady ? 'compatible' : 'pending_config',
          httpCode: sessionReady ? 'ACTIVA' : 'CONFIG',
          detectedDataType: 'Sesión de perfil (profile_token)',
          validationResult: sessionReady
            ? `Sesión activa en memoria para "${inMemorySession?.selectedProfileName || inMemorySession?.selectedProfileId || 'perfil'}".`
            : tokenTransport === 'unconfirmed'
            ? 'Ruta configurada (cuerpo {}), pendiente confirmar el mecanismo de envío de tokens.'
            : 'Ruta configurada. Selecciona un perfil tras login-iptv para emitir profile_token en memoria.',
        });
      }

      const useBackendForProbes = shouldUseSecureBackend(tempConn);
      const mapBackendDiagToBucket = (
        diag: BackendUpstreamDiagnostic | undefined,
        fallbackLabel: string
      ) => {
        if (!diag || diag.ok) return;
        const cat: DiagnosticErrorCategory = diag.category || 'provider_http';
        if (!errorBuckets.has(cat)) {
          errorBuckets.set(cat, {
            summary: `${fallbackLabel}: ${diag.message}`,
            detail: diag.detail,
            httpCode: diag.httpStatus ? String(diag.httpStatus) : undefined,
          });
        }
      };

      const mapBackendDiagToProbeStatus = (
        diag: BackendUpstreamDiagnostic | undefined
      ): EndpointProbeStatus => {
        if (!diag) return 'server_error';
        if (diag.category === 'auth_error' || diag.category === 'session_error') {
          return 'auth_required';
        }
        if (diag.httpStatus === 404) return 'not_found';
        return 'server_error';
      };

      if (useBackendForProbes) {
        viaBackend = true;
        const backendRes = await diagnoseViaBackend(tempConn);
        if (backendRes.session) {
          inMemorySession = backendRes.session;
          setBackendSafeSnapshot(backendRes.session);
          if (backendRes.session.status === 'expired') {
            errorBuckets.set('session_error', {
              summary: 'Sesión de perfil expirada en memoria del servidor.',
              detail: backendRes.session.statusMessage,
            });
          } else if (backendRes.session.hasDeviceToken) {
            capabilities.auth = true;
          }
        }

        if (!backendRes.ok) {
          const cat: DiagnosticErrorCategory =
            backendRes.errorCategory || 'connection_error';
          errorBuckets.set(cat, {
            summary:
              backendRes.message ||
              'Error de comunicación al consultar el backend seguro de NEXUS.',
          });
          detectedErrors.push(
            backendRes.message ||
              'El backend seguro NEXUS rechazó o no pudo completar la consulta al proveedor.'
          );
        } else {
          // Actualizar probe de sesión si ya cambió con la respuesta del servidor
          const sessionProbe = probes.find((p) => p.id === 'custom-profile-session');
          if (
            sessionProbe &&
            backendRes.session?.status === 'session_active' &&
            backendRes.session.hasProfileToken
          ) {
            sessionProbe.status = 'compatible';
            sessionProbe.httpCode = 'ACTIVA';
            sessionProbe.validationResult = `Sesión activa en memoria del servidor para "${backendRes.session.selectedProfileName || backendRes.session.selectedProfileId || 'perfil'}".`;
          }

          if (accountTemplate) {
            const accUrl = applyEndpointTemplate(normalizedUrl, accountTemplate, {
              catalogId: catId,
            });
            if (backendRes.account?.ok) {
              capabilities.account = true;
              suggestedEndpoints.accountEndpoint = accountTemplate;
              if (accountTemplate.includes('/api/player/catalog/')) {
                detectedPreset = 'netsky';
              }
              accountInfo = backendRes.account.accountInfo;
              probes.push({
                id: 'custom-account',
                endpoint: sanitizeUrlForDisplay(accUrl),
                method: 'GET',
                status: 'compatible',
                httpCode: String(backendRes.account.httpStatus || 200),
                detectedDataType: 'Información de cuenta / catálogo',
                validationResult:
                  'JSON de cuenta verificado desde backend Express (sin CORS de navegador).',
              });
            } else {
              const diag = backendRes.account?.diagnostic;
              mapBackendDiagToBucket(diag, 'Cuenta');
              probes.push({
                id: 'custom-account',
                endpoint: sanitizeUrlForDisplay(accUrl),
                method: 'GET',
                status: mapBackendDiagToProbeStatus(diag),
                httpCode: diag?.httpStatus ? String(diag.httpStatus) : 'ERR',
                detectedDataType: 'Información de cuenta',
                validationResult: diag
                  ? `${diag.message}${diag.detail ? ` ${diag.detail}` : ''}`
                  : 'No disponible.',
              });
              if (diag?.message) detectedErrors.push(`Cuenta: ${diag.message}`);
            }
          }

          if (moviesTemplate) {
            const movUrl = applyEndpointTemplate(normalizedUrl, moviesTemplate, {
              catalogId: catId,
              type: 'movie',
            });
            if (backendRes.movies?.ok) {
              detectedType = 'custom_api';
              if (moviesTemplate.includes('/api/player/catalog/')) {
                detectedPreset = 'netsky';
              }
              capabilities.movies = true;
              suggestedEndpoints.moviesEndpoint = moviesTemplate;
              backendRes.movies.formats.forEach((f) => discoveredContainers.add(f));
              probes.push({
                id: 'custom-movies',
                endpoint: sanitizeUrlForDisplay(movUrl),
                method: 'GET',
                status: 'compatible',
                httpCode: String(backendRes.movies.httpStatus || 200),
                detectedDataType: `Películas (${backendRes.movies.count} ítems)`,
                validationResult: `Estructura JSON validada desde backend (${backendRes.movies.count} películas${backendRes.movies.formats.length ? `, formatos: ${backendRes.movies.formats.join(', ').toUpperCase()}` : ''}).`,
                sampleCount: backendRes.movies.count,
                discoveredFormats: backendRes.movies.formats,
              });
            } else {
              const diag = backendRes.movies?.diagnostic;
              mapBackendDiagToBucket(diag, 'Películas');
              probes.push({
                id: 'custom-movies',
                endpoint: sanitizeUrlForDisplay(movUrl),
                method: 'GET',
                status: mapBackendDiagToProbeStatus(diag),
                httpCode: diag?.httpStatus ? String(diag.httpStatus) : 'ERR',
                detectedDataType: 'Catálogo de películas',
                validationResult: diag
                  ? `${diag.message}${diag.detail ? ` ${diag.detail}` : ''}`
                  : 'No disponible.',
              });
              if (diag?.message) detectedErrors.push(`Películas: ${diag.message}`);
            }
          }

          if (seriesTemplate) {
            const serUrl = applyEndpointTemplate(normalizedUrl, seriesTemplate, {
              catalogId: catId,
              type: 'series',
            });
            if (backendRes.series?.ok) {
              detectedType = 'custom_api';
              capabilities.series = true;
              suggestedEndpoints.seriesEndpoint = seriesTemplate;
              backendRes.series.formats.forEach((f) => discoveredContainers.add(f));
              probes.push({
                id: 'custom-series',
                endpoint: sanitizeUrlForDisplay(serUrl),
                method: 'GET',
                status: 'compatible',
                httpCode: String(backendRes.series.httpStatus || 200),
                detectedDataType: `Series (${backendRes.series.count} ítems)`,
                validationResult: `Estructura JSON validada desde backend (${backendRes.series.count} series).`,
                sampleCount: backendRes.series.count,
                discoveredFormats: backendRes.series.formats,
              });
            } else {
              const diag = backendRes.series?.diagnostic;
              mapBackendDiagToBucket(diag, 'Series');
              probes.push({
                id: 'custom-series',
                endpoint: sanitizeUrlForDisplay(serUrl),
                method: 'GET',
                status: mapBackendDiagToProbeStatus(diag),
                httpCode: diag?.httpStatus ? String(diag.httpStatus) : 'ERR',
                detectedDataType: 'Catálogo de series',
                validationResult: diag
                  ? `${diag.message}${diag.detail ? ` ${diag.detail}` : ''}`
                  : 'No disponible.',
              });
              if (diag?.message) detectedErrors.push(`Series: ${diag.message}`);
            }
          }
        }
      }

      // Probar endpoint de cuenta en modo directo navegador (solo si no usó backend)
      if (!useBackendForProbes && accountTemplate) {
        const url = applyEndpointTemplate(normalizedUrl, accountTemplate, {
          catalogId: catId,
        });
        const reqCfg = await resolveInMemorySessionRequest(tempConn, url);
        const out = await executeSafeProbe(
          reqCfg.url,
          Object.keys(reqCfg.headers).length > 0 ? reqCfg.headers : headers
        );
        if (out.ok && out.jsonBody && typeof out.jsonBody === 'object' && !Array.isArray(out.jsonBody)) {
          const rec = out.jsonBody as Record<string, unknown>;
          const looksLikeAccount = Object.keys(rec).length > 0;
          if (looksLikeAccount) {
            capabilities.account = true;
            suggestedEndpoints.accountEndpoint = accountTemplate;
            if (accountTemplate.includes('/api/player/catalog/')) {
              detectedPreset = 'netsky';
            }
            accountInfo = {
              status: String(rec.status || rec.state || 'Activo'),
              expDate: rec.expiresAt
                ? String(rec.expiresAt)
                : rec.expDate
                ? String(rec.expDate)
                : undefined,
              rawSummary: Object.entries(rec)
                .filter(([k]) => !/pass|secret|token/i.test(k))
                .slice(0, 4)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(' · '),
            };
            probes.push({
              id: 'custom-account',
              endpoint: sanitizeUrlForDisplay(url),
              method: 'GET',
              status: 'compatible',
              httpCode: out.httpCode,
              detectedDataType: 'Información de cuenta / catálogo',
              validationResult: `Objeto JSON válido recibido (${Object.keys(rec).length} campos).`,
            });
          } else {
            probes.push({
              id: 'custom-account',
              endpoint: sanitizeUrlForDisplay(url),
              method: 'GET',
              status: 'server_error',
              httpCode: out.httpCode,
              detectedDataType: 'Información de cuenta',
              validationResult: 'HTTP 200 con JSON vacío.',
            });
          }
        } else {
          probes.push({
            id: 'custom-account',
            endpoint: sanitizeUrlForDisplay(url),
            method: 'GET',
            status: out.ok ? 'server_error' : out.probeStatus,
            httpCode: out.httpCode,
            detectedDataType: 'Información de cuenta',
            validationResult: out.ok
              ? 'HTTP 200 pero el cuerpo no es un objeto JSON de cuenta válido.'
              : out.errorDetail || 'No disponible.',
          });
          if (out.errorDetail) detectedErrors.push(`Cuenta: ${out.errorDetail}`);
        }
      } else if (!useBackendForProbes) {
        probes.push({
          id: 'custom-account',
          endpoint: catId ? '/api/player/catalog/{catalogId}/account' : 'Requiere catalogId',
          method: 'GET',
          status: 'pending_config',
          httpCode: '—',
          detectedDataType: 'Información de cuenta',
          validationResult: catId
            ? 'Endpoint de cuenta no configurado.'
            : 'Introduce un Identificador de catálogo (catalogId) para probar la ruta de cuenta.',
        });
      }

      // Probar endpoint de películas (modo directo navegador)
      if (!useBackendForProbes && moviesTemplate) {
        const url = applyEndpointTemplate(normalizedUrl, moviesTemplate, {
          catalogId: catId,
          type: 'movie',
        });
        const reqCfg = await resolveInMemorySessionRequest(tempConn, url);
        const out = await executeSafeProbe(
          reqCfg.url,
          Object.keys(reqCfg.headers).length > 0 ? reqCfg.headers : headers
        );
        const items = out.ok ? extractCatalogArray(out.jsonBody) : [];
        const hasValidItems =
          out.ok &&
          (Array.isArray(out.jsonBody) || Boolean(out.jsonBody && typeof out.jsonBody === 'object')) &&
          (items.length === 0
            ? Array.isArray(out.jsonBody)
            : Boolean(items[0]?.id !== undefined && items[0]?.name !== undefined));

        if (hasValidItems) {
          detectedType = 'custom_api';
          if (moviesTemplate.includes('/api/player/catalog/')) {
            detectedPreset = 'netsky';
          }
          capabilities.movies = true;
          suggestedEndpoints.moviesEndpoint = moviesTemplate;
          const exts = summarizeContainers(items);
          exts.forEach((e) => discoveredContainers.add(e));
          probes.push({
            id: 'custom-movies',
            endpoint: sanitizeUrlForDisplay(url),
            method: 'GET',
            status: 'compatible',
            httpCode: out.httpCode,
            detectedDataType: `Películas (${items.length} ítems)`,
            validationResult: `Estructura JSON validada (${items.length} películas${exts.length ? `, formatos: ${exts.join(', ').toUpperCase()}` : ''}).`,
            sampleCount: items.length,
            discoveredFormats: exts,
          });
        } else {
          probes.push({
            id: 'custom-movies',
            endpoint: sanitizeUrlForDisplay(url),
            method: 'GET',
            status: out.ok ? 'server_error' : out.probeStatus,
            httpCode: out.httpCode,
            detectedDataType: 'Catálogo de películas',
            validationResult: out.ok
              ? 'HTTP 200 pero el JSON no contiene estructura válida de catálogo (id, name).'
              : out.errorDetail || 'No disponible.',
          });
          if (out.errorDetail) detectedErrors.push(`Películas: ${out.errorDetail}`);
        }
      } else if (!useBackendForProbes) {
        probes.push({
          id: 'custom-movies',
          endpoint: 'Requiere catalogId o ruta manual',
          method: 'GET',
          status: 'pending_config',
          httpCode: '—',
          detectedDataType: 'Catálogo de películas',
          validationResult: 'Especifica catalogId o configura la ruta de películas.',
        });
      }

      // Probar endpoint de series (modo directo navegador)
      if (!useBackendForProbes && seriesTemplate) {
        const url = applyEndpointTemplate(normalizedUrl, seriesTemplate, {
          catalogId: catId,
          type: 'series',
        });
        const reqCfg = await resolveInMemorySessionRequest(tempConn, url);
        const out = await executeSafeProbe(
          reqCfg.url,
          Object.keys(reqCfg.headers).length > 0 ? reqCfg.headers : headers
        );
        const items = out.ok ? extractCatalogArray(out.jsonBody) : [];
        const hasValidItems =
          out.ok &&
          (Array.isArray(out.jsonBody) || Boolean(out.jsonBody && typeof out.jsonBody === 'object')) &&
          (items.length === 0
            ? Array.isArray(out.jsonBody)
            : Boolean(items[0]?.id !== undefined && items[0]?.name !== undefined));

        if (hasValidItems) {
          detectedType = 'custom_api';
          capabilities.series = true;
          suggestedEndpoints.seriesEndpoint = seriesTemplate;
          const exts = summarizeContainers(items);
          exts.forEach((e) => discoveredContainers.add(e));
          probes.push({
            id: 'custom-series',
            endpoint: sanitizeUrlForDisplay(url),
            method: 'GET',
            status: 'compatible',
            httpCode: out.httpCode,
            detectedDataType: `Series (${items.length} ítems)`,
            validationResult: `Estructura JSON validada (${items.length} series).`,
            sampleCount: items.length,
            discoveredFormats: exts,
          });
        } else {
          probes.push({
            id: 'custom-series',
            endpoint: sanitizeUrlForDisplay(url),
            method: 'GET',
            status: out.ok ? 'server_error' : out.probeStatus,
            httpCode: out.httpCode,
            detectedDataType: 'Catálogo de series',
            validationResult: out.ok
              ? 'HTTP 200 pero el JSON no contiene estructura válida de series.'
              : out.errorDetail || 'No disponible.',
          });
          if (out.errorDetail) detectedErrors.push(`Series: ${out.errorDetail}`);
        }
      } else if (!useBackendForProbes) {
        probes.push({
          id: 'custom-series',
          endpoint: 'Requiere catalogId o ruta manual',
          method: 'GET',
          status: 'pending_config',
          httpCode: '—',
          detectedDataType: 'Catálogo de series',
          validationResult: 'Especifica catalogId o configura la ruta de series.',
        });
      }

      // TV en vivo (solo si configurado)
      if (!useBackendForProbes && liveTemplate) {
        const url = applyEndpointTemplate(normalizedUrl, liveTemplate, { catalogId: catId });
        const reqCfg = await resolveInMemorySessionRequest(tempConn, url);
        const out = await executeSafeProbe(
          reqCfg.url,
          Object.keys(reqCfg.headers).length > 0 ? reqCfg.headers : headers
        );
        const items = out.ok ? extractCatalogArray(out.jsonBody) : [];
        if (out.ok && items.length >= 0 && Array.isArray(out.jsonBody)) {
          capabilities.liveTv = true;
        }
        probes.push({
          id: 'custom-live',
          endpoint: sanitizeUrlForDisplay(url),
          method: 'GET',
          status: out.ok ? 'compatible' : out.probeStatus,
          httpCode: out.httpCode,
          detectedDataType: `TV en vivo (${items.length})`,
          validationResult: out.ok
            ? `Endpoint respondido (${items.length} canales).`
            : out.errorDetail || 'No disponible.',
        });
      }

      // Detalles, temporadas/episodios y reproducción: NO inventar endpoints
      probes.push({
        id: 'custom-details',
        endpoint: detailsTemplate || 'No configurado',
        method: 'GET',
        status: detailsTemplate ? 'compatible' : 'pending_config',
        httpCode: detailsTemplate ? 'CONFIG' : '—',
        detectedDataType: 'Detalles extendidos',
        validationResult: detailsTemplate
          ? 'Ruta personalizada configurada manualmente (requiere un {id} de título para consultar).'
          : 'Pendiente de configurar. No se asume ni inventa ruta de detalles.',
      });
      if (detailsTemplate) capabilities.details = true;

      probes.push({
        id: 'custom-seasons',
        endpoint: seasonsTemplate || 'No configurado',
        method: 'GET',
        status: seasonsTemplate ? 'compatible' : 'pending_config',
        httpCode: seasonsTemplate ? 'CONFIG' : '—',
        detectedDataType: 'Temporadas y episodios',
        validationResult: seasonsTemplate
          ? 'Ruta de temporadas/episodios configurada manualmente.'
          : 'Pendiente de configurar. Se necesita la ruta real de temporadas/episodios del proveedor.',
      });
      if (seasonsTemplate) capabilities.seasonsAndEpisodes = true;

      probes.push({
        id: 'custom-playback',
        endpoint: playbackTemplate || 'No configurado',
        method: 'GET',
        status: playbackTemplate ? 'compatible' : 'pending_config',
        httpCode: playbackTemplate ? 'CONFIG' : '—',
        detectedDataType: 'Fuentes de reproducción',
        validationResult: playbackTemplate
          ? 'Ruta de reproducción configurada manualmente.'
          : 'Pendiente de configurar. Sin este endpoint no es posible obtener enlaces de streaming reproducibles.',
      });
      if (playbackTemplate) capabilities.playback = true;
    }

    // Analizar compatibilidad de contenedores descubiertos para el reproductor
    const containerList = Array.from(discoveredContainers);
    const incompatibleFormats = containerList.filter(
      (ext) => !analyzeMediaFormat(ext).browserCompatible
    );
    const compatibleFormats = containerList.filter(
      (ext) => analyzeMediaFormat(ext).browserCompatible
    );

    const anyCors = probes.some((p) => p.status === 'cors_error');
    const anyAuthErr = probes.some((p) => p.status === 'auth_required');
    const anyServerErr = probes.some((p) => p.status === 'server_error');
    const anyCompatible = probes.some((p) => p.status === 'compatible');
    const anyPending = probes.some((p) => p.status === 'pending_config');
    const hasVerifiedData =
      capabilities.movies || capabilities.series || capabilities.liveTv;

    // Construir los 6 canales separados de error y verificación requeridos
    const connBucket = errorBuckets.get('connection_error');
    const httpBucket = errorBuckets.get('provider_http');
    const authBucket = errorBuckets.get('auth_error');
    const sessBucket = errorBuckets.get('session_error');
    const catBucket = errorBuckets.get('catalog_error');
    const networkProbeErr = probes.find(
      (p) => p.status === 'server_error' && p.httpCode === 'RED'
    );
    const httpProbeErr = probes.find(
      (p) =>
        (p.status === 'server_error' || p.status === 'not_found') &&
        p.httpCode !== 'RED'
    );

    const categorizedErrors: CategorizedDiagnosticItem[] = [
      {
        category: 'browser_cors',
        label: 'Error CORS del navegador',
        hasError: anyCors,
        status: anyCors ? 'error' : viaBackend ? 'ok' : anyCompatible ? 'ok' : 'pending',
        httpCode: anyCors ? 'CORS' : viaBackend ? 'RELAY' : undefined,
        summary: anyCors
          ? 'Bloqueo CORS directo en navegador'
          : viaBackend
          ? 'Evitado mediante backend seguro Express'
          : 'Sin bloqueo CORS detectado',
        detail: anyCors
          ? 'El proveedor no autoriza este origen en Access-Control-Allow-Origin (ej. Netsky solo permite http://tv.zenbu.fans). Activa el modo "Backend seguro Express" para estas consultas.'
          : viaBackend
          ? 'Las peticiones no salen directamente del navegador sino desde el backend Express de NEXUS. El CORS propio del backend autoriza únicamente los dominios de NEXUS y no altera la política del proveedor.'
          : undefined,
      },
      {
        category: 'connection_error',
        label: 'Error de conexión',
        hasError: Boolean(connBucket || networkProbeErr),
        status: connBucket || networkProbeErr ? 'error' : anyCompatible ? 'ok' : 'pending',
        httpCode: connBucket?.httpCode || networkProbeErr?.httpCode,
        summary:
          connBucket?.summary ||
          networkProbeErr?.validationResult ||
          (anyCompatible ? 'Servidor alcanzable' : 'Sin verificar'),
        detail: connBucket?.detail,
      },
      {
        category: 'provider_http',
        label: 'Error HTTP del proveedor',
        hasError: Boolean(httpBucket || httpProbeErr),
        status: httpBucket || httpProbeErr ? 'error' : anyCompatible ? 'ok' : 'pending',
        httpCode: httpBucket?.httpCode || httpProbeErr?.httpCode,
        summary:
          httpBucket?.summary ||
          httpProbeErr?.validationResult ||
          (anyCompatible ? 'Respuestas HTTP válidas' : 'Sin verificar'),
        detail: httpBucket?.detail,
      },
      {
        category: 'auth_error',
        label: 'Error de autenticación',
        hasError: Boolean(authBucket || anyAuthErr),
        status:
          authBucket || anyAuthErr
            ? 'error'
            : capabilities.auth
            ? 'ok'
            : 'pending',
        httpCode: authBucket?.httpCode,
        summary:
          authBucket?.summary ||
          (anyAuthErr
            ? 'El proveedor rechazó credenciales o token'
            : capabilities.auth
            ? 'Autenticación operativa'
            : 'login-iptv o envío de token pendiente'),
        detail: authBucket?.detail,
      },
      {
        category: 'session_error',
        label: 'Error de sesión',
        hasError: Boolean(sessBucket || inMemorySession?.status === 'expired'),
        status:
          sessBucket || inMemorySession?.status === 'expired'
            ? 'error'
            : inMemorySession?.status === 'session_active'
            ? 'ok'
            : 'pending',
        httpCode: sessBucket?.httpCode,
        summary:
          sessBucket?.summary ||
          (inMemorySession?.status === 'expired'
            ? 'Sesión expirada; requiere renovación'
            : inMemorySession?.status === 'session_active'
            ? `Sesión activa (${inMemorySession.selectedProfileName || 'Perfil'})`
            : 'Sin sesión de perfil iniciada'),
        detail: sessBucket?.detail || inMemorySession?.statusMessage,
      },
      {
        category: 'catalog_error',
        label: 'Error de catálogo',
        hasError: Boolean(catBucket),
        status: catBucket
          ? 'error'
          : hasVerifiedData
          ? 'ok'
          : 'pending',
        httpCode: catBucket?.httpCode,
        summary:
          catBucket?.summary ||
          (hasVerifiedData
            ? 'Estructura JSON de catálogo comprobada'
            : 'Sin catálogo validado aún'),
        detail: catBucket?.detail,
      },
    ];

    // Construir las 7 dimensiones del diagnóstico visual
    const dimensions: DiagnosticDimension[] = [
      {
        key: 'connectivity',
        label: 'Conectividad del servidor',
        state:
          anyCors || Boolean(connBucket) || Boolean(httpBucket)
            ? 'error'
            : anyCompatible
            ? 'ok'
            : detectedErrors.length > 0
            ? 'error'
            : 'warning',
        summary: anyCors
          ? 'Bloqueo CORS en navegador'
          : connBucket
          ? 'Error de conexión con el servidor'
          : httpBucket
          ? `Rechazo HTTP del proveedor (${httpBucket.httpCode || 'ERR'})`
          : anyCompatible
          ? viaBackend
            ? `Conectado vía Backend Express (${protocol} · ${domain})`
            : `Conectado (${protocol} · ${domain})`
          : 'Sin respuesta compatible',
        detail: anyCors
          ? 'El servidor no permite peticiones directas del navegador (falta Access-Control-Allow-Origin para este dominio).'
          : httpBucket?.detail || connBucket?.detail,
      },
      {
        key: 'auth',
        label: 'Estado de autenticación',
        state:
          inMemorySession?.status === 'session_active' || (capabilities.auth && !authBucket && !anyAuthErr)
            ? 'ok'
            : inMemorySession?.status === 'expired' || anyAuthErr || Boolean(authBucket || sessBucket)
            ? 'error'
            : inMemorySession?.status === 'device_authenticated' || capabilities.account
            ? 'warning'
            : 'pending',
        summary:
          inMemorySession?.status === 'session_active'
            ? `Sesión activa (${inMemorySession.selectedProfileName || 'Perfil'})`
            : inMemorySession?.status === 'device_authenticated'
            ? 'Dispositivo autenticado · Elige perfil'
            : inMemorySession?.status === 'expired'
            ? 'Sesión expirada · Renovar'
            : authBucket
            ? 'Error de autenticación'
            : capabilities.auth
            ? 'Autenticado correctamente'
            : anyAuthErr
            ? 'Requiere autenticación o envío de token'
            : capabilities.account
            ? 'Cuenta detectada; login-iptv/sesión pendiente'
            : 'Pendiente de configurar',
        detail:
          authBucket?.detail ||
          sessBucket?.detail ||
          inMemorySession?.statusMessage ||
          accountInfo?.rawSummary ||
          accountInfo?.status,
      },
      {
        key: 'movies',
        label: 'Catálogo de películas',
        state: capabilities.movies
          ? 'ok'
          : anyCors || Boolean(catBucket || httpBucket || connBucket || authBucket)
          ? 'error'
          : 'pending',
        summary: capabilities.movies
          ? `Operativo (${probes.find((p) => p.id.includes('vod') || p.id.includes('movies'))?.sampleCount ?? 0} títulos)`
          : 'No validado o con error',
      },
      {
        key: 'series',
        label: 'Catálogo de series',
        state: capabilities.series
          ? 'ok'
          : anyCors || Boolean(catBucket || httpBucket || connBucket || authBucket)
          ? 'error'
          : 'pending',
        summary: capabilities.series
          ? `Operativo (${probes.find((p) => p.id.includes('series'))?.sampleCount ?? 0} series)`
          : 'No validado o con error',
      },
      {
        key: 'details',
        label: 'Detalles de títulos',
        state: capabilities.details ? 'ok' : 'pending',
        summary: capabilities.details ? 'Disponible' : 'Pendiente de configurar',
      },
      {
        key: 'seasons',
        label: 'Temporadas y episodios',
        state: capabilities.seasonsAndEpisodes ? 'ok' : 'pending',
        summary: capabilities.seasonsAndEpisodes
          ? 'Disponible'
          : 'Pendiente de configurar',
      },
      {
        key: 'player',
        label: 'Estado del reproductor',
        state:
          !capabilities.playback
            ? 'pending'
            : incompatibleFormats.length > 0 && compatibleFormats.length === 0
            ? 'warning'
            : 'ok',
        summary: !capabilities.playback
          ? 'Pendiente de endpoint de reproducción'
          : incompatibleFormats.length > 0
          ? `Contenedores detectados: ${containerList.join(', ').toUpperCase()} (MKV requiere HLS/MP4)`
          : compatibleFormats.length > 0
          ? `Compatible (${compatibleFormats.join(', ').toUpperCase()})`
          : 'Listo para HLS.js / HTML5 Video',
        detail:
          incompatibleFormats.length > 0
            ? `Se detectaron archivos ${incompatibleFormats.join(', ').toUpperCase()}. Los navegadores web no reproducen MKV directamente sin transcodificación a HLS (.m3u8) o MP4.`
            : undefined,
      },
    ];

    // No marcar conexión como exitosa hasta comprobar una respuesta de catálogo válida
    let overallStatus: ConnectionStatus = 'untested';
    if (anyCors) overallStatus = 'cors_error';
    else if ((anyAuthErr || Boolean(authBucket || sessBucket)) && !hasVerifiedData) {
      overallStatus = 'auth_error';
    } else if (hasVerifiedData && !anyPending && !anyServerErr && !anyAuthErr && errorBuckets.size === 0) {
      overallStatus = 'connected';
    } else if ((hasVerifiedData || capabilities.account) && (anyPending || errorBuckets.size > 0)) {
      overallStatus = 'pending_config';
    } else {
      overallStatus = 'network_error';
    }

    const summaryMessage =
      overallStatus === 'connected'
        ? `API verificada (${detectedType.toUpperCase()}): todos los módulos probados devolvieron respuestas válidas.`
        : overallStatus === 'pending_config'
        ? hasVerifiedData
          ? `Catálogo verificado parcialmente (${detectedType.toUpperCase()}). Revisa los elementos pendientes o errores en el desglose.`
          : `Conexión parcial (${detectedType.toUpperCase()}): aún no se ha validado el catálogo de películas o series.`
        : overallStatus === 'cors_error'
        ? 'Error CORS en navegador: el servidor bloquea solicitudes directas desde este origen web.'
        : overallStatus === 'auth_error'
        ? 'Error de autenticación/sesión: inicia sesión o confirma el mecanismo de envío de tokens.'
        : 'Error de comunicación o respuesta inválida del proveedor.';

    return {
      id: `disc-${Date.now()}`,
      testedAt: Date.now(),
      inputUrl: rawTarget,
      normalizedUrl,
      protocol,
      domain,
      requestedType: input.requestedType,
      detectedType,
      detectedPreset,
      suggestedEndpoints,
      suggestedCapabilities: capabilities,
      accountInfo,
      probes,
      dimensions,
      categorizedErrors,
      viaBackend,
      detectedErrors,
      securityNotes,
      overallStatus,
      summaryMessage,
    };
  }

  private buildFailedUrlReport(
    input: DiscoveryInput,
    rawTarget: string,
    normalizedUrl: string,
    protocol: string,
    domain: string,
    detectedErrors: string[],
    securityNotes: string[]
  ): DiscoveryReport {
    return {
      id: `disc-${Date.now()}`,
      testedAt: Date.now(),
      inputUrl: rawTarget,
      normalizedUrl,
      protocol,
      domain,
      requestedType: input.requestedType,
      detectedType: input.requestedType === 'auto' ? 'custom_api' : input.requestedType,
      detectedPreset: 'custom_generic',
      suggestedEndpoints: input.customEndpoints || {},
      suggestedCapabilities: {
        auth: false,
        account: false,
        liveTv: false,
        movies: false,
        series: false,
        details: false,
        seasonsAndEpisodes: false,
        playback: false,
      },
      probes: [],
      dimensions: [
        {
          key: 'connectivity',
          label: 'Conectividad del servidor',
          state: 'error',
          summary: 'URL inválida o vacía',
        },
        { key: 'auth', label: 'Estado de autenticación', state: 'pending', summary: 'Sin verificar' },
        { key: 'movies', label: 'Catálogo de películas', state: 'pending', summary: 'Sin verificar' },
        { key: 'series', label: 'Catálogo de series', state: 'pending', summary: 'Sin verificar' },
        { key: 'details', label: 'Detalles de títulos', state: 'pending', summary: 'Sin verificar' },
        { key: 'seasons', label: 'Temporadas y episodios', state: 'pending', summary: 'Sin verificar' },
        { key: 'player', label: 'Estado del reproductor', state: 'pending', summary: 'Sin verificar' },
      ],
      detectedErrors,
      securityNotes,
      overallStatus: 'network_error',
      summaryMessage: 'Introduce una URL http:// o https:// válida para iniciar la detección.',
    };
  }
}

export const providerDiscoveryService = new ProviderDiscoveryService();
