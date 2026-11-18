import {
  CatalogItem,
  DiagnosticErrorCategory,
  IptvConnection,
  NetskySafeSessionView,
  ProviderAccountInfo,
} from '../types/iptv';
import { normalizeServerUrl } from '../utils/networkErrors';

export interface BackendUpstreamDiagnostic {
  ok: boolean;
  category?: DiagnosticErrorCategory;
  httpStatus?: number;
  message: string;
  detail?: string;
  providerOriginPolicyDetected?: boolean;
}

export interface BackendDiagnoseResponse {
  ok: boolean;
  errorCategory?: DiagnosticErrorCategory;
  message?: string;
  session?: NetskySafeSessionView;
  account?: {
    ok: boolean;
    httpStatus?: number;
    accountInfo?: ProviderAccountInfo;
    diagnostic: BackendUpstreamDiagnostic;
  } | null;
  movies?: {
    ok: boolean;
    httpStatus?: number;
    count: number;
    formats: string[];
    diagnostic: BackendUpstreamDiagnostic;
  } | null;
  series?: {
    ok: boolean;
    httpStatus?: number;
    count: number;
    formats: string[];
    diagnostic: BackendUpstreamDiagnostic;
  } | null;
}

// Estado de handshake en memoria del navegador (no persistido en LocalStorage ni es un token del proveedor)
let internalSessionToken: string | null = null;
let authorizedProviderHostsCache: string[] = ['v3kt-orbe.zenbu.fans'];
let handshakePromise: Promise<string | null> | null = null;

async function ensureBackendSessionToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && internalSessionToken) {
    return internalSessionToken;
  }
  if (!forceRefresh && handshakePromise) {
    return handshakePromise;
  }

  handshakePromise = (async () => {
    try {
      const res = await fetch('/api/nexus/session/handshake', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Client': 'nexus-iptv-web',
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        sessionToken?: string;
        authorizedProviderHosts?: string[];
      };
      if (data.ok && data.sessionToken) {
        internalSessionToken = data.sessionToken;
        if (Array.isArray(data.authorizedProviderHosts)) {
          authorizedProviderHostsCache = data.authorizedProviderHosts;
        }
        return internalSessionToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      handshakePromise = null;
    }
  })();

  return handshakePromise;
}

async function backendFetch<T>(
  path: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown }
): Promise<{ status: number; data: T | null; networkError?: string }> {
  let token = await ensureBackendSessionToken(false);
  if (!token) {
    return {
      status: 0,
      data: null,
      networkError:
        'No se pudo establecer la sesión segura con el backend Node.js/Express de NEXUS.',
    };
  }

  const exec = async (tok: string) =>
    fetch(path, {
      method: init.method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Nexus-Session': tok,
        'X-Nexus-Client': 'nexus-iptv-web',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  try {
    let res = await exec(token);
    if (res.status === 401) {
      const refreshed = await ensureBackendSessionToken(true);
      if (refreshed) {
        res = await exec(refreshed);
      }
    }

    const text = await res.text();
    let parsed: T | null = null;
    try {
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, data: parsed };
  } catch (err) {
    return {
      status: 0,
      data: null,
      networkError:
        err instanceof Error
          ? err.message
          : 'Error de red al comunicarse con el backend de NEXUS.',
    };
  }
}

export function isHostAuthorizedOnBackend(serverUrl: string): boolean {
  try {
    const parsed = new URL(normalizeServerUrl(serverUrl));
    return authorizedProviderHostsCache.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function shouldUseSecureBackend(connection: Pick<IptvConnection, 'type' | 'preset' | 'communicationMode' | 'serverUrl'>): boolean {
  if (connection.type !== 'custom_api') return false;
  if (connection.communicationMode === 'direct_browser') return false;
  if (connection.communicationMode === 'backend_secure') return true;
  if (connection.preset === 'netsky') return true;
  return isHostAuthorizedOnBackend(connection.serverUrl);
}

function buildProviderPayloadConfig(conn: IptvConnection) {
  const ep = conn.customEndpoints || {};
  return {
    serverUrl: normalizeServerUrl(conn.serverUrl),
    catalogId: conn.catalogId?.trim() || undefined,
    profileSessionEndpoint: ep.profileSessionEndpoint?.trim() || undefined,
    tokenTransport: ep.tokenTransport || 'unconfirmed',
    sessionTokenSource: ep.sessionTokenSource || 'profile_token',
    tokenQueryParam: ep.tokenQueryParam?.trim() || undefined,
    authHeaderName: ep.authHeaderName?.trim() || undefined,
    tokenPrefix: ep.tokenPrefix?.trim() || undefined,
    staticToken: conn.token?.trim() || undefined,
  };
}

export async function getBackendSessionState(
  connectionId: string
): Promise<NetskySafeSessionView> {
  const res = await backendFetch<{
    ok?: boolean;
    session?: NetskySafeSessionView;
  }>(`/api/nexus/providers/${encodeURIComponent(connectionId)}/session`, {
    method: 'GET',
  });

  if (res.data?.session) {
    return res.data.session;
  }

  return {
    connectionId,
    status: 'logged_out',
    hasDeviceToken: false,
    hasProfileToken: false,
    profiles: [],
  };
}

export async function loginViaBackend(connection: IptvConnection): Promise<{
  ok: boolean;
  session: NetskySafeSessionView;
  diagnostic?: BackendUpstreamDiagnostic;
}> {
  const ep = connection.customEndpoints || {};
  const res = await backendFetch<{
    ok?: boolean;
    session?: NetskySafeSessionView;
    diagnostic?: BackendUpstreamDiagnostic;
    message?: string;
    errorCategory?: DiagnosticErrorCategory;
  }>(`/api/nexus/providers/${encodeURIComponent(connection.id)}/login-iptv`, {
    method: 'POST',
    body: {
      ...buildProviderPayloadConfig(connection),
      username: connection.username?.trim() || '',
      password: connection.password || '',
      loginIptvEndpoint:
        ep.loginIptvEndpoint?.trim() || ep.authEndpoint?.trim() || '',
      loginIptvMethod: ep.loginIptvMethod || 'POST',
    },
  });

  if (res.networkError || !res.data) {
    return {
      ok: false,
      session: {
        connectionId: connection.id,
        status: 'error',
        hasDeviceToken: false,
        hasProfileToken: false,
        profiles: [],
        statusMessage:
          res.networkError || 'Error de comunicación con el backend de NEXUS.',
      },
      diagnostic: {
        ok: false,
        category: 'connection_error',
        message: res.networkError || 'Backend no disponible.',
      },
    };
  }

  return {
    ok: Boolean(res.data.ok),
    session: res.data.session || {
      connectionId: connection.id,
      status: 'error',
      hasDeviceToken: false,
      hasProfileToken: false,
      profiles: [],
      statusMessage: res.data.message,
    },
    diagnostic:
      res.data.diagnostic ||
      (res.data.message
        ? {
            ok: Boolean(res.data.ok),
            category: res.data.errorCategory || 'auth_error',
            message: res.data.message,
          }
        : undefined),
  };
}

export async function createProfileSessionViaBackend(
  connection: IptvConnection,
  profileId: string
): Promise<{
  ok: boolean;
  session: NetskySafeSessionView;
  diagnostic?: BackendUpstreamDiagnostic;
}> {
  const res = await backendFetch<{
    ok?: boolean;
    session?: NetskySafeSessionView;
    diagnostic?: BackendUpstreamDiagnostic;
    message?: string;
    errorCategory?: DiagnosticErrorCategory;
  }>(
    `/api/nexus/providers/${encodeURIComponent(connection.id)}/profile-session`,
    {
      method: 'POST',
      body: {
        ...buildProviderPayloadConfig(connection),
        profileId,
      },
    }
  );

  if (res.networkError || !res.data) {
    return {
      ok: false,
      session: {
        connectionId: connection.id,
        status: 'error',
        hasDeviceToken: false,
        hasProfileToken: false,
        profiles: [],
        statusMessage:
          res.networkError || 'Error de comunicación con el backend de NEXUS.',
      },
    };
  }

  return {
    ok: Boolean(res.data.ok),
    session: res.data.session || {
      connectionId: connection.id,
      status: 'error',
      hasDeviceToken: false,
      hasProfileToken: false,
      profiles: [],
      statusMessage: res.data.message,
    },
    diagnostic: res.data.diagnostic,
  };
}

export async function logoutViaBackend(
  connectionId: string
): Promise<NetskySafeSessionView> {
  const res = await backendFetch<{
    ok?: boolean;
    session?: NetskySafeSessionView;
  }>(`/api/nexus/providers/${encodeURIComponent(connectionId)}/session`, {
    method: 'DELETE',
  });

  return (
    res.data?.session || {
      connectionId,
      status: 'logged_out',
      hasDeviceToken: false,
      hasProfileToken: false,
      profiles: [],
    }
  );
}

export async function fetchCatalogViaBackend(
  connection: IptvConnection,
  mediaType: 'movie' | 'series' | 'live',
  endpointTemplate?: string
): Promise<{
  ok: boolean;
  items: CatalogItem[];
  diagnostic: BackendUpstreamDiagnostic;
}> {
  const res = await backendFetch<{
    ok?: boolean;
    items?: CatalogItem[];
    diagnostic?: BackendUpstreamDiagnostic;
    message?: string;
    errorCategory?: DiagnosticErrorCategory;
  }>(`/api/nexus/providers/${encodeURIComponent(connection.id)}/catalog`, {
    method: 'POST',
    body: {
      ...buildProviderPayloadConfig(connection),
      mediaType,
      endpointTemplate,
    },
  });

  if (res.networkError || !res.data) {
    return {
      ok: false,
      items: [],
      diagnostic: {
        ok: false,
        category: 'connection_error',
        message:
          res.networkError || 'Error al contactar con el backend de NEXUS.',
      },
    };
  }

  if (!res.data.ok) {
    return {
      ok: false,
      items: [],
      diagnostic: res.data.diagnostic || {
        ok: false,
        category: res.data.errorCategory || 'catalog_error',
        httpStatus: res.status || undefined,
        message: res.data.message || 'No se pudo cargar el catálogo desde el backend.',
      },
    };
  }

  return {
    ok: true,
    items: Array.isArray(res.data.items) ? res.data.items : [],
    diagnostic: res.data.diagnostic || {
      ok: true,
      message: 'Catálogo cargado correctamente.',
    },
  };
}

export async function queryEndpointViaBackend(
  connection: IptvConnection,
  endpointTemplate: string,
  vars: Record<string, string | number | undefined>
): Promise<{
  ok: boolean;
  data?: unknown;
  diagnostic: BackendUpstreamDiagnostic;
}> {
  const res = await backendFetch<{
    ok?: boolean;
    data?: unknown;
    diagnostic?: BackendUpstreamDiagnostic;
    message?: string;
    errorCategory?: DiagnosticErrorCategory;
  }>(`/api/nexus/providers/${encodeURIComponent(connection.id)}/query`, {
    method: 'POST',
    body: {
      ...buildProviderPayloadConfig(connection),
      endpointTemplate,
      vars,
    },
  });

  if (res.networkError || !res.data) {
    return {
      ok: false,
      diagnostic: {
        ok: false,
        category: 'connection_error',
        message:
          res.networkError || 'Error de comunicación con el backend de NEXUS.',
      },
    };
  }

  return {
    ok: Boolean(res.data.ok),
    data: res.data.data,
    diagnostic: res.data.diagnostic || {
      ok: Boolean(res.data.ok),
      category: res.data.errorCategory,
      message: res.data.message || 'Consulta completada.',
    },
  };
}

export async function diagnoseViaBackend(
  connection: IptvConnection
): Promise<BackendDiagnoseResponse> {
  const ep = connection.customEndpoints || {};
  const res = await backendFetch<BackendDiagnoseResponse>(
    `/api/nexus/providers/${encodeURIComponent(connection.id)}/diagnose`,
    {
      method: 'POST',
      body: {
        ...buildProviderPayloadConfig(connection),
        accountEndpoint: ep.accountEndpoint?.trim() || undefined,
        moviesEndpoint: ep.moviesEndpoint?.trim() || undefined,
        seriesEndpoint: ep.seriesEndpoint?.trim() || undefined,
        liveEndpoint: ep.liveEndpoint?.trim() || undefined,
        loginIptvEndpoint: ep.loginIptvEndpoint?.trim() || undefined,
        authEndpoint: ep.authEndpoint?.trim() || undefined,
      },
    }
  );

  if (res.networkError || !res.data) {
    return {
      ok: false,
      errorCategory: 'connection_error',
      message:
        res.networkError || 'No se pudo completar el diagnóstico en el backend.',
    };
  }

  return res.data;
}
