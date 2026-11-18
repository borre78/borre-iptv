import {
  IptvConnection,
  NetskyProfile,
  NetskySafeSessionView,
  NetskySessionStatus,
} from '../types/iptv';
import {
  diagnoseFetchError,
  diagnoseHttpStatus,
  isValidHttpUrl,
  normalizeServerUrl,
} from '../utils/networkErrors';
import { applyEndpointTemplate } from './adapters/types';
import {
  createProfileSessionViaBackend,
  getBackendSessionState,
  loginViaBackend,
  logoutViaBackend,
  shouldUseSecureBackend,
} from './backendClient';

/**
 * Estado privado estrictamente en memoria.
 * Nunca se serializa en LocalStorage ni se expone en pantalla o registros.
 */
interface InternalMemorySession {
  connectionId: string;
  deviceToken?: string;
  profileToken?: string;
  deviceTokenExpiresAt?: number;
  profileTokenExpiresAt?: number;
  accountSummary?: Record<string, string | number | boolean>;
  profiles: NetskyProfile[];
  selectedProfileId?: string;
  selectedProfileName?: string;
  status: NetskySessionStatus;
  statusMessage?: string;
  lastUpdatedAt?: number;
}

const memorySessions = new Map<string, InternalMemorySession>();
const backendSafeSnapshots = new Map<string, NetskySafeSessionView>();
const sessionListeners = new Set<() => void>();

function notifySessionChange() {
  sessionListeners.forEach((cb) => cb());
}

export function subscribeNetskySessions(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/**
 * Decodifica únicamente el campo `exp` de un JWT en memoria sin exponer ni registrar el token.
 */
function extractJwtExpirationMs(token?: string): number | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) {
      return decoded.exp * 1000;
    }
  } catch {
    // No es un JWT estándar con payload JSON
  }
  return undefined;
}

function isTokenExpired(expiresAt?: number, bufferMs = 30_000): boolean {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - bufferMs;
}

function sanitizeAccountRecord(
  raw: unknown
): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/token|pass|pwd|secret|key|jwt|auth/i.test(k)) {
      continue;
    }
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      safe[k] = v;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function normalizeProfilesList(raw: unknown): NetskyProfile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((rec, idx) => {
      const id = String(rec.id ?? rec.profileId ?? rec.profile_id ?? idx + 1);
      const name = String(rec.name ?? rec.title ?? rec.username ?? `Perfil ${idx + 1}`);
      return {
        id,
        name,
        avatar: typeof rec.avatar === 'string' ? rec.avatar : typeof rec.logo === 'string' ? rec.logo : undefined,
        isDefault: Boolean(rec.isDefault ?? rec.is_default),
        isKids: Boolean(rec.isKids ?? rec.is_kids),
      };
    });
}

function buildAuthRequestConfig(
  connection: IptvConnection,
  token: string | undefined,
  baseHeaders: Record<string, string> = { Accept: 'application/json' }
): {
  headers: Record<string, string>;
  applyQueryToUrl: (url: string) => string;
  transportConfigured: boolean;
} {
  const ep = connection.customEndpoints || {};
  const transport = ep.tokenTransport || 'unconfirmed';

  if (!token || transport === 'unconfirmed') {
    return {
      headers: baseHeaders,
      applyQueryToUrl: (u) => u,
      transportConfigured: false,
    };
  }

  if (transport === 'bearer_header') {
    return {
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${token}`,
      },
      applyQueryToUrl: (u) => u,
      transportConfigured: true,
    };
  }

  if (transport === 'custom_header') {
    const headerName = ep.authHeaderName?.trim() || 'Authorization';
    const prefix = ep.tokenPrefix?.trim();
    return {
      headers: {
        ...baseHeaders,
        [headerName]: prefix ? `${prefix} ${token}` : token,
      },
      applyQueryToUrl: (u) => u,
      transportConfigured: true,
    };
  }

  // query_param
  const paramName = ep.tokenQueryParam?.trim() || 'token';
  return {
    headers: baseHeaders,
    applyQueryToUrl: (rawUrl: string) => {
      try {
        const u = new URL(rawUrl);
        u.searchParams.set(paramName, token);
        return u.toString();
      } catch {
        return rawUrl;
      }
    },
    transportConfigured: true,
  };
}

export function setBackendSafeSnapshot(view: NetskySafeSessionView): void {
  backendSafeSnapshots.set(view.connectionId, view);
  notifySessionChange();
}

export async function syncNetskySessionFromBackend(
  connection: IptvConnection
): Promise<NetskySafeSessionView> {
  if (!shouldUseSecureBackend(connection)) {
    return getSafeNetskySessionView(connection.id);
  }
  const view = await getBackendSessionState(connection.id);
  backendSafeSnapshots.set(connection.id, view);
  notifySessionChange();
  return view;
}

export function getSafeNetskySessionView(
  connectionId: string
): NetskySafeSessionView {
  const backendSnap = backendSafeSnapshots.get(connectionId);
  if (backendSnap) {
    return backendSnap;
  }

  const mem = memorySessions.get(connectionId);
  if (!mem) {
    return {
      connectionId,
      status: 'logged_out',
      hasDeviceToken: false,
      hasProfileToken: false,
      profiles: [],
    };
  }

  let effectiveStatus = mem.status;
  if (
    mem.status === 'session_active' &&
    isTokenExpired(mem.profileTokenExpiresAt, 0)
  ) {
    effectiveStatus = 'expired';
  } else if (
    mem.status === 'device_authenticated' &&
    isTokenExpired(mem.deviceTokenExpiresAt, 0)
  ) {
    effectiveStatus = 'expired';
  }

  return {
    connectionId,
    status: effectiveStatus,
    hasDeviceToken: Boolean(mem.deviceToken),
    hasProfileToken: Boolean(mem.profileToken),
    deviceTokenExpiresAt: mem.deviceTokenExpiresAt,
    profileTokenExpiresAt: mem.profileTokenExpiresAt,
    accountSummary: mem.accountSummary,
    profiles: mem.profiles,
    selectedProfileId: mem.selectedProfileId,
    selectedProfileName: mem.selectedProfileName,
    statusMessage: mem.statusMessage,
    lastUpdatedAt: mem.lastUpdatedAt,
  };
}

export function logoutNetskySession(connectionId: string): NetskySafeSessionView {
  memorySessions.delete(connectionId);
  backendSafeSnapshots.delete(connectionId);
  void logoutViaBackend(connectionId);
  notifySessionChange();
  return getSafeNetskySessionView(connectionId);
}

/**
 * Paso 1-2 del flujo Netsky:
 * Autenticación inicial mediante el endpoint login-iptv configurable.
 * Cuando se usa el backend seguro de NEXUS, device_token permanece solo en RAM del servidor.
 */
export async function loginNetskyIptv(
  connection: IptvConnection
): Promise<NetskySafeSessionView> {
  if (shouldUseSecureBackend(connection)) {
    const res = await loginViaBackend(connection);
    backendSafeSnapshots.set(connection.id, res.session);
    notifySessionChange();
    return res.session;
  }

  const baseUrl = normalizeServerUrl(connection.serverUrl);
  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    const state: InternalMemorySession = {
      connectionId: connection.id,
      profiles: [],
      status: 'error',
      statusMessage: 'La URL base del servidor Netsky no es válida.',
      lastUpdatedAt: Date.now(),
    };
    memorySessions.set(connection.id, state);
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }

  const loginRoute =
    connection.customEndpoints?.loginIptvEndpoint?.trim() ||
    connection.customEndpoints?.authEndpoint?.trim();

  if (!loginRoute) {
    const state: InternalMemorySession = {
      connectionId: connection.id,
      profiles: [],
      status: 'pending_config',
      statusMessage:
        'La ruta de login-iptv aún no está configurada. Configúrala en "Endpoints de API personalizada" sin inventar rutas.',
      lastUpdatedAt: Date.now(),
    };
    memorySessions.set(connection.id, state);
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }

  if (!connection.username?.trim() || !connection.password) {
    const state: InternalMemorySession = {
      connectionId: connection.id,
      profiles: [],
      status: 'error',
      statusMessage:
        'Ingresa usuario y contraseña en la conexión antes de iniciar sesión.',
      lastUpdatedAt: Date.now(),
    };
    memorySessions.set(connection.id, state);
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }

  const method = connection.customEndpoints?.loginIptvMethod || 'POST';
  const targetUrl = applyEndpointTemplate(baseUrl, loginRoute, {
    catalogId: connection.catalogId,
    username: connection.username,
  });

  try {
    const res = await fetch(targetUrl, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body:
        method === 'POST'
          ? JSON.stringify({
              username: connection.username.trim(),
              password: connection.password,
              ...(connection.catalogId?.trim()
                ? { catalogId: connection.catalogId.trim() }
                : {}),
            })
          : undefined,
    });

    if (!res.ok) {
      const diag = diagnoseHttpStatus(res.status, targetUrl);
      memorySessions.set(connection.id, {
        connectionId: connection.id,
        profiles: [],
        status: 'error',
        statusMessage: `${diag.title}: ${diag.message}`,
        lastUpdatedAt: Date.now(),
      });
      notifySessionChange();
      return getSafeNetskySessionView(connection.id);
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const deviceToken =
      typeof payload.device_token === 'string'
        ? payload.device_token
        : typeof payload.deviceToken === 'string'
        ? payload.deviceToken
        : undefined;
    const profiles = normalizeProfilesList(payload.profiles);
    const accountSummary = sanitizeAccountRecord(payload.account);

    if (!deviceToken) {
      memorySessions.set(connection.id, {
        connectionId: connection.id,
        profiles,
        accountSummary,
        status: 'error',
        statusMessage:
          'El servidor respondió HTTP 200, pero no devolvió el campo device_token esperado.',
        lastUpdatedAt: Date.now(),
      });
      notifySessionChange();
      return getSafeNetskySessionView(connection.id);
    }

    const deviceExp = extractJwtExpirationMs(deviceToken);

    memorySessions.set(connection.id, {
      connectionId: connection.id,
      deviceToken,
      deviceTokenExpiresAt: deviceExp,
      accountSummary,
      profiles,
      status: 'device_authenticated',
      statusMessage:
        profiles.length > 0
          ? `Autenticación de dispositivo completada (${profiles.length} perfiles disponibles). Selecciona un perfil para crear la sesión.`
          : 'Autenticación de dispositivo completada en memoria.',
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  } catch (err) {
    const diag = diagnoseFetchError(err, targetUrl);
    memorySessions.set(connection.id, {
      connectionId: connection.id,
      profiles: [],
      status: 'error',
      statusMessage: `${diag.title}: ${diag.message}`,
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }
}

/**
 * Paso 3-4 del flujo Netsky:
 * Crear o renovar sesión de perfil mediante:
 * POST /api/v1/profiles/{profileId}/session con cuerpo {}
 * Devuelve { profile_token: "JWT" } mantenido estrictamente en memoria.
 */
export async function createOrRenewProfileSession(
  connection: IptvConnection,
  profileId: string
): Promise<NetskySafeSessionView> {
  if (shouldUseSecureBackend(connection)) {
    const res = await createProfileSessionViaBackend(connection, profileId);
    backendSafeSnapshots.set(connection.id, res.session);
    notifySessionChange();
    return res.session;
  }

  const mem = memorySessions.get(connection.id);
  const baseUrl = normalizeServerUrl(connection.serverUrl);

  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    return getSafeNetskySessionView(connection.id);
  }

  if (!mem?.deviceToken) {
    memorySessions.set(connection.id, {
      connectionId: connection.id,
      profiles: mem?.profiles || [],
      status: 'expired',
      statusMessage:
        'No hay device_token activo en memoria. Inicia sesión nuevamente mediante login-iptv.',
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }

  if (isTokenExpired(mem.deviceTokenExpiresAt)) {
    memorySessions.set(connection.id, {
      ...mem,
      deviceToken: undefined,
      profileToken: undefined,
      status: 'expired',
      statusMessage:
        'El device_token ha expirado. Inicia sesión nuevamente para obtener nuevos tokens.',
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }

  const sessionTemplate =
    connection.customEndpoints?.profileSessionEndpoint?.trim() ||
    '/api/v1/profiles/{profileId}/session';

  const rawUrl = applyEndpointTemplate(baseUrl, sessionTemplate, {
    profileId,
    id: profileId,
    catalogId: connection.catalogId,
  });

  const authConfig = buildAuthRequestConfig(connection, mem.deviceToken, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  // Nota: si tokenTransport está en 'unconfirmed', no inventamos un header oculto si el usuario no lo ha confirmado;
  // avisamos claramente para que configure el mecanismo de envío de token.
  if (!authConfig.transportConfigured) {
    memorySessions.set(connection.id, {
      ...mem,
      selectedProfileId: profileId,
      selectedProfileName:
        mem.profiles.find((p) => p.id === profileId)?.name || profileId,
      status: 'pending_config',
      statusMessage:
        'Falta confirmar el mecanismo de envío de tokens (ej. Authorization: Bearer o cabecera personalizada) en la configuración de la conexión antes de crear la sesión de perfil.',
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }

  const finalUrl = authConfig.applyQueryToUrl(rawUrl);

  try {
    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: authConfig.headers,
      body: JSON.stringify({}),
    });

    if (res.status === 401 || res.status === 403) {
      memorySessions.set(connection.id, {
        ...mem,
        profileToken: undefined,
        status: 'expired',
        statusMessage: `El servidor rechazó la creación de sesión (HTTP ${res.status}). Verifica el mecanismo de autorización o renueva el login inicial.`,
        lastUpdatedAt: Date.now(),
      });
      notifySessionChange();
      return getSafeNetskySessionView(connection.id);
    }

    if (!res.ok) {
      const diag = diagnoseHttpStatus(res.status, finalUrl);
      memorySessions.set(connection.id, {
        ...mem,
        status: 'error',
        statusMessage: `${diag.title}: ${diag.message}`,
        lastUpdatedAt: Date.now(),
      });
      notifySessionChange();
      return getSafeNetskySessionView(connection.id);
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const profileToken =
      typeof payload.profile_token === 'string'
        ? payload.profile_token
        : typeof payload.profileToken === 'string'
        ? payload.profileToken
        : undefined;

    if (!profileToken) {
      memorySessions.set(connection.id, {
        ...mem,
        status: 'error',
        statusMessage:
          'La respuesta del endpoint de sesión no incluyó profile_token.',
        lastUpdatedAt: Date.now(),
      });
      notifySessionChange();
      return getSafeNetskySessionView(connection.id);
    }

    const profileExp = extractJwtExpirationMs(profileToken);
    const chosenProfile = mem.profiles.find((p) => p.id === profileId);

    memorySessions.set(connection.id, {
      ...mem,
      profileToken,
      profileTokenExpiresAt: profileExp,
      selectedProfileId: profileId,
      selectedProfileName: chosenProfile?.name || profileId,
      status: 'session_active',
      statusMessage: `Sesión de perfil activa para "${chosenProfile?.name || profileId}". Tokens mantenidos únicamente en memoria.`,
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  } catch (err) {
    const diag = diagnoseFetchError(err, finalUrl);
    memorySessions.set(connection.id, {
      ...mem,
      status: 'error',
      statusMessage: `${diag.title}: ${diag.message}`,
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return getSafeNetskySessionView(connection.id);
  }
}

/**
 * Obtiene la configuración de autorización en memoria para consultar catálogos,
 * renovando automáticamente el profile_token si ha expirado y existe device_token válido.
 */
export async function resolveInMemorySessionRequest(
  connection: IptvConnection,
  rawUrl: string
): Promise<{
  url: string;
  headers: Record<string, string>;
  canRetryOn401: boolean;
}> {
  const mem = memorySessions.get(connection.id);
  const ep = connection.customEndpoints || {};
  const transport = ep.tokenTransport || 'unconfirmed';

  if (
    mem &&
    mem.selectedProfileId &&
    mem.deviceToken &&
    !isTokenExpired(mem.deviceTokenExpiresAt) &&
    (!mem.profileToken || isTokenExpired(mem.profileTokenExpiresAt))
  ) {
    if (transport !== 'unconfirmed') {
      await createOrRenewProfileSession(connection, mem.selectedProfileId);
    }
  }

  const latestMem = memorySessions.get(connection.id);
  const preferredSource = ep.sessionTokenSource || 'profile_token';
  const sessionToken =
    preferredSource === 'device_token'
      ? latestMem?.deviceToken || latestMem?.profileToken
      : latestMem?.profileToken || latestMem?.deviceToken;

  const effectiveToken = sessionToken || connection.token?.trim();

  if (transport === 'unconfirmed' && !connection.token?.trim()) {
    return {
      url: rawUrl,
      headers: { Accept: 'application/json' },
      canRetryOn401: false,
    };
  }

  // Si el usuario introdujo manualmente un token estático y no tocó tokenTransport, respetar buildAuthHeaders tradicional
  if (transport === 'unconfirmed' && connection.token?.trim()) {
    const headerName = ep.authHeaderName?.trim() || 'Authorization';
    const prefix = ep.tokenPrefix?.trim();
    return {
      url: rawUrl,
      headers: {
        Accept: 'application/json',
        [headerName]: prefix ? `${prefix} ${connection.token.trim()}` : connection.token.trim(),
      },
      canRetryOn401: false,
    };
  }

  const cfg = buildAuthRequestConfig(connection, effectiveToken);
  return {
    url: cfg.applyQueryToUrl(rawUrl),
    headers: cfg.headers,
    canRetryOn401: Boolean(
      latestMem?.deviceToken &&
        latestMem?.selectedProfileId &&
        !isTokenExpired(latestMem.deviceTokenExpiresAt)
    ),
  };
}

/**
 * Si una solicitud de catálogo devuelve 401/403, intenta renovar la sesión de perfil
 * una única vez utilizando el device_token en memoria (si aún es válido).
 */
export async function attemptSessionRenewalOnUnauthorized(
  connection: IptvConnection
): Promise<boolean> {
  const mem = memorySessions.get(connection.id);
  if (!mem || !mem.deviceToken || !mem.selectedProfileId) {
    return false;
  }

  if (isTokenExpired(mem.deviceTokenExpiresAt)) {
    memorySessions.set(connection.id, {
      ...mem,
      deviceToken: undefined,
      profileToken: undefined,
      status: 'expired',
      statusMessage:
        'La sesión y el device_token han expirado. Inicia sesión nuevamente.',
      lastUpdatedAt: Date.now(),
    });
    notifySessionChange();
    return false;
  }

  const renewed = await createOrRenewProfileSession(
    connection,
    mem.selectedProfileId
  );
  return renewed.status === 'session_active';
}
