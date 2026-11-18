import 'dotenv/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Secreto efímero por arranque si no se define en variables de entorno (nunca se imprime en consola)
const SESSION_SIGNING_SECRET =
  process.env.NEXUS_SESSION_SECRET?.trim() || randomBytes(32).toString('hex');

const DEFAULT_AUTHORIZED_PROVIDER_HOSTS = ['v3kt-orbe.zenbu.fans'];

function buildAuthorizedProviderHosts(): Set<string> {
  const hosts = new Set<string>(DEFAULT_AUTHORIZED_PROVIDER_HOSTS);
  const rawEnv = process.env.AUTHORIZED_PROVIDER_HOSTS || '';
  for (const entry of rawEnv.split(',')) {
    const clean = entry.trim().toLowerCase();
    if (clean && !isBlockedInternalHost(clean)) {
      hosts.add(clean);
    }
  }
  return hosts;
}

function buildStaticAllowedOrigins(): Set<string> {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://localhost:3000',
  ]);

  const candidates = [
    process.env.APP_URL || '',
    ...(process.env.ALLOWED_ORIGINS || '').split(','),
  ];

  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignorar entradas inválidas
    }
  }
  return origins;
}

function isBlockedInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  // Bloquear rangos IPv4 privados / loopback / link-local / metadata SSRF
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) {
    return true;
  }
  return false;
}

const AUTHORIZED_PROVIDER_HOSTS = buildAuthorizedProviderHosts();
const STATIC_ALLOWED_ORIGINS = buildStaticAllowedOrigins();

type TokenTransportMechanism =
  | 'unconfirmed'
  | 'bearer_header'
  | 'custom_header'
  | 'query_param';

type ErrorCategory =
  | 'browser_cors'
  | 'connection_error'
  | 'provider_http'
  | 'auth_error'
  | 'session_error'
  | 'catalog_error';

interface ProviderRequestConfig {
  serverUrl: string;
  catalogId?: string;
  profileSessionEndpoint?: string;
  tokenTransport?: TokenTransportMechanism;
  sessionTokenSource?: 'profile_token' | 'device_token';
  tokenQueryParam?: string;
  authHeaderName?: string;
  tokenPrefix?: string;
  staticToken?: string;
}

interface NetskyProfile {
  id: string;
  name: string;
  avatar?: string;
  isDefault?: boolean;
  isKids?: boolean;
}

interface ServerProviderSession {
  key: string;
  connectionId: string;
  deviceToken?: string;
  profileToken?: string;
  deviceTokenExpiresAt?: number;
  profileTokenExpiresAt?: number;
  accountSummary?: Record<string, string | number | boolean>;
  profiles: NetskyProfile[];
  selectedProfileId?: string;
  selectedProfileName?: string;
  status:
    | 'logged_out'
    | 'device_authenticated'
    | 'session_active'
    | 'expired'
    | 'pending_config'
    | 'error';
  statusMessage?: string;
  lastUpdatedAt: number;
  lastConfig?: ProviderRequestConfig;
}

interface NexusClientSession {
  sid: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

interface UpstreamDiagnostic {
  ok: boolean;
  category?: ErrorCategory;
  httpStatus?: number;
  message: string;
  detail?: string;
  providerOriginPolicyDetected?: boolean;
}

const CLIENT_TTL_MS = 1000 * 60 * 60 * 8; // 8 horas
const nexusClients = new Map<string, NexusClientSession>();
const providerSessions = new Map<string, ServerProviderSession>();

// Limpieza periódica en memoria sin persistencia en disco ni BD
setInterval(() => {
  const now = Date.now();
  for (const [sid, client] of nexusClients.entries()) {
    if (client.expiresAt <= now) {
      nexusClients.delete(sid);
      for (const [pkey] of providerSessions.entries()) {
        if (pkey.startsWith(`${sid}::`)) {
          providerSessions.delete(pkey);
        }
      }
    }
  }
}, 1000 * 60 * 10).unref();

function signSid(sid: string): string {
  const sig = createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(sid)
    .digest('hex');
  return `${sid}.${sig}`;
}

function verifySignedSid(rawCookie: string | undefined): string | null {
  if (!rawCookie) return null;
  const dotIdx = rawCookie.indexOf('.');
  if (dotIdx <= 0) return null;
  const sid = rawCookie.slice(0, dotIdx);
  const sigHex = rawCookie.slice(dotIdx + 1);
  if (!/^[a-f0-9]{48}$/.test(sid) || !/^[a-f0-9]{64}$/.test(sigHex)) {
    return null;
  }
  const expectedHex = createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(sid)
    .digest('hex');
  const a = Buffer.from(sigHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  return sid;
}

function safeCompareTokens(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseCookies(headerValue: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headerValue) return out;
  for (const part of headerValue.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function resolveRequestOwnOrigin(req: Request): string | null {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return null;
  const protoRaw = req.get('x-forwarded-proto') || req.protocol || 'http';
  const proto = protoRaw.split(',')[0].trim();
  if (proto !== 'http' && proto !== 'https') return null;
  return `${proto}://${host}`;
}

function isOriginAuthorizedForBackend(req: Request, origin: string): boolean {
  if (STATIC_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }
  const ownOrigin = resolveRequestOwnOrigin(req);
  if (ownOrigin && origin === ownOrigin) {
    return true;
  }
  return false;
}

function extractJwtExpirationMs(token?: string): number | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      exp?: number;
    };
    if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) {
      return decoded.exp * 1000;
    }
  } catch {
    // No es un JWT con payload JSON legible
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
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object')
    )
    .map((rec, idx) => ({
      id: String(rec.id ?? rec.profileId ?? rec.profile_id ?? idx + 1),
      name: String(rec.name ?? rec.title ?? rec.username ?? `Perfil ${idx + 1}`),
      avatar:
        typeof rec.avatar === 'string'
          ? rec.avatar
          : typeof rec.logo === 'string'
          ? rec.logo
          : undefined,
      isDefault: Boolean(rec.isDefault ?? rec.is_default),
      isKids: Boolean(rec.isKids ?? rec.is_kids),
    }));
}

function toSafeSessionView(
  connectionId: string,
  mem: ServerProviderSession | undefined
) {
  if (!mem) {
    return {
      connectionId,
      status: 'logged_out' as const,
      hasDeviceToken: false,
      hasProfileToken: false,
      profiles: [] as NetskyProfile[],
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

function validateAuthorizedProviderUrl(rawServerUrl: unknown): {
  ok: true;
  origin: string;
  hostname: string;
} | {
  ok: false;
  code: number;
  category: ErrorCategory | 'provider_not_authorized';
  message: string;
} {
  if (typeof rawServerUrl !== 'string' || !rawServerUrl.trim()) {
    return {
      ok: false,
      code: 400,
      category: 'connection_error',
      message: 'Falta la URL base del servidor proveedor.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawServerUrl.trim());
  } catch {
    return {
      ok: false,
      code: 400,
      category: 'connection_error',
      message: 'La URL base del servidor proveedor no tiene un formato válido.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      code: 400,
      category: 'connection_error',
      message: 'Solo se permiten protocolos HTTP/HTTPS.',
    };
  }

  const hostLower = parsed.hostname.toLowerCase();
  if (isBlockedInternalHost(hostLower)) {
    return {
      ok: false,
      code: 403,
      category: 'provider_not_authorized',
      message: 'Las direcciones locales o privadas están bloqueadas por seguridad.',
    };
  }

  if (!AUTHORIZED_PROVIDER_HOSTS.has(hostLower)) {
    return {
      ok: false,
      code: 403,
      category: 'provider_not_authorized',
      message: `El dominio "${hostLower}" no está en la lista de proveedores autorizados del backend NEXUS. No se permiten destinos arbitrarios.`,
    };
  }

  return {
    ok: true,
    origin: parsed.origin,
    hostname: hostLower,
  };
}

function applyTemplatePathSafe(
  targetOrigin: string,
  rawTemplate: unknown,
  vars: Record<string, string | number | undefined>
): { ok: true; url: string } | { ok: false; message: string } {
  if (typeof rawTemplate !== 'string' || !rawTemplate.trim()) {
    return { ok: false, message: 'Ruta de endpoint vacía o no configurada.' };
  }

  let pathStr = rawTemplate.trim();
  if (/[\r\n\0\s]/.test(pathStr) || pathStr.includes('..') || pathStr.includes('@')) {
    return { ok: false, message: 'Ruta de endpoint con caracteres no permitidos.' };
  }

  // Si viene URL completa, verificar que pertenezca exactamente al mismo origen autorizado
  if (/^https?:\/\//i.test(pathStr)) {
    try {
      const full = new URL(pathStr);
      if (full.origin !== targetOrigin) {
        return {
          ok: false,
          message: 'El endpoint no puede apuntar a un origen distinto al servidor autorizado.',
        };
      }
      pathStr = `${full.pathname}${full.search}`;
    } catch {
      return { ok: false, message: 'Formato de endpoint inválido.' };
    }
  } else if (pathStr.startsWith('//')) {
    return { ok: false, message: 'Formato de ruta relativo inválido.' };
  }

  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) {
      pathStr = pathStr.replaceAll(`{${k}}`, encodeURIComponent(String(v)));
    }
  }

  if (!pathStr.startsWith('/')) {
    pathStr = `/${pathStr}`;
  }

  try {
    const resolved = new URL(pathStr, targetOrigin);
    if (resolved.origin !== targetOrigin) {
      return { ok: false, message: 'El endpoint resuelto excede el origen autorizado.' };
    }
    return { ok: true, url: resolved.toString() };
  } catch {
    return { ok: false, message: 'No se pudo construir la URL del endpoint.' };
  }
}

function buildTokenTransportConfig(
  cfg: ProviderRequestConfig,
  token: string | undefined,
  baseHeaders: Record<string, string> = { Accept: 'application/json' }
): {
  headers: Record<string, string>;
  applyQuery: (url: string) => string;
  transportConfirmed: boolean;
} {
  const transport = cfg.tokenTransport || 'unconfirmed';

  if (transport === 'unconfirmed') {
    if (cfg.staticToken?.trim()) {
      const headerName = cfg.authHeaderName?.trim() || 'Authorization';
      const prefix = cfg.tokenPrefix?.trim();
      return {
        headers: {
          ...baseHeaders,
          [headerName]: prefix
            ? `${prefix} ${cfg.staticToken.trim()}`
            : cfg.staticToken.trim(),
        },
        applyQuery: (u) => u,
        transportConfirmed: true,
      };
    }
    return {
      headers: baseHeaders,
      applyQuery: (u) => u,
      transportConfirmed: false,
    };
  }

  const effectiveToken = token || cfg.staticToken?.trim();
  if (!effectiveToken) {
    return {
      headers: baseHeaders,
      applyQuery: (u) => u,
      transportConfirmed: true,
    };
  }

  if (transport === 'bearer_header') {
    return {
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${effectiveToken}`,
      },
      applyQuery: (u) => u,
      transportConfirmed: true,
    };
  }

  if (transport === 'custom_header') {
    const headerName = cfg.authHeaderName?.trim() || 'Authorization';
    const prefix = cfg.tokenPrefix?.trim();
    return {
      headers: {
        ...baseHeaders,
        [headerName]: prefix ? `${prefix} ${effectiveToken}` : effectiveToken,
      },
      applyQuery: (u) => u,
      transportConfirmed: true,
    };
  }

  // query_param
  const paramName = cfg.tokenQueryParam?.trim() || 'token';
  return {
    headers: baseHeaders,
    applyQuery: (rawUrl: string) => {
      const u = new URL(rawUrl);
      u.searchParams.set(paramName, effectiveToken);
      return u.toString();
    },
    transportConfirmed: true,
  };
}

async function fetchUpstreamWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000
): Promise<{ ok: true; response: globalThis.Response } | { ok: false; diagnostic: UpstreamDiagnostic }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    });
    return { ok: true, response };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const rawMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostic: {
        ok: false,
        category: 'connection_error',
        message: isTimeout
          ? 'Tiempo de espera agotado al conectar con el servidor del proveedor.'
          : 'Error de conexión servidor-a-servidor con el proveedor.',
        detail: rawMsg,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function classifyHttpFailure(
  res: globalThis.Response,
  context: 'auth' | 'session' | 'catalog' | 'account',
  transportConfirmed: boolean
): Promise<UpstreamDiagnostic> {
  let bodySnippet = '';
  try {
    bodySnippet = (await res.text()).slice(0, 600);
  } catch {
    bodySnippet = '';
  }

  const mentionsOriginRestriction =
    /access-control|origin|tv\.zenbu\.fans|cloudflare|forbidden by policy/i.test(
      bodySnippet
    );

  if (res.status === 401) {
    return {
      ok: false,
      category: context === 'session' ? 'session_error' : 'auth_error',
      httpStatus: 401,
      message: `El proveedor devolvió HTTP 401 (No autorizado).`,
      detail: transportConfirmed
        ? 'Las credenciales o el token de sesión fueron rechazados o han expirado.'
        : 'El mecanismo de envío de tokens está pendiente de confirmar o no hay sesión activa.',
    };
  }

  if (res.status === 403) {
    if (mentionsOriginRestriction || context === 'account' || context === 'catalog') {
      return {
        ok: false,
        category: 'provider_http',
        httpStatus: 403,
        providerOriginPolicyDetected: mentionsOriginRestriction,
        message: `El proveedor bloqueó la solicitud servidor-a-servidor (HTTP 403).`,
        detail:
          'Si Netsky bloquea peticiones fuera de su origen web autorizado (ej. http://tv.zenbu.fans) o exige autorización específica para este servidor, debe solicitarse autorización explícita al proveedor.',
      };
    }
    return {
      ok: false,
      category: context === 'session' ? 'session_error' : 'auth_error',
      httpStatus: 403,
      message: `Acceso denegado por el proveedor (HTTP 403).`,
      detail:
        'El servidor rechazó la autenticación o requiere permisos/origen autorizado por el proveedor.',
    };
  }

  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      category: 'provider_http',
      httpStatus: res.status,
      message: `El proveedor devolvió una redirección inesperada (HTTP ${res.status}).`,
      detail: 'No se siguen redirecciones externas automáticamente por seguridad.',
    };
  }

  if (res.status === 404) {
    return {
      ok: false,
      category: 'provider_http',
      httpStatus: 404,
      message: 'Endpoint no encontrado en el servidor del proveedor (HTTP 404).',
      detail: 'Verifica la ruta configurada y el catalogId.',
    };
  }

  return {
    ok: false,
    category: 'provider_http',
    httpStatus: res.status,
    message: `Error HTTP del proveedor (HTTP ${res.status}).`,
    detail: 'El servidor del proveedor no pudo completar la solicitud.',
  };
}

async function performProfileSessionCreation(
  sessionKey: string,
  connectionId: string,
  profileId: string,
  cfg: ProviderRequestConfig
): Promise<{
  ok: boolean;
  sessionView: ReturnType<typeof toSafeSessionView>;
  diagnostic: UpstreamDiagnostic;
}> {
  const mem = providerSessions.get(sessionKey);
  if (!mem?.deviceToken) {
    const updated: ServerProviderSession = {
      key: sessionKey,
      connectionId,
      profiles: mem?.profiles || [],
      status: 'expired',
      statusMessage:
        'No existe device_token activo en la memoria del servidor. Inicia sesión mediante login-iptv.',
      lastUpdatedAt: Date.now(),
      lastConfig: cfg,
    };
    providerSessions.set(sessionKey, updated);
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, updated),
      diagnostic: {
        ok: false,
        category: 'session_error',
        message: 'No hay device_token activo en memoria del servidor.',
      },
    };
  }

  if (isTokenExpired(mem.deviceTokenExpiresAt)) {
    const updated: ServerProviderSession = {
      ...mem,
      deviceToken: undefined,
      profileToken: undefined,
      status: 'expired',
      statusMessage:
        'El device_token ha expirado en el servidor. Vuelve a iniciar sesión mediante login-iptv.',
      lastUpdatedAt: Date.now(),
    };
    providerSessions.set(sessionKey, updated);
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, updated),
      diagnostic: {
        ok: false,
        category: 'session_error',
        message: 'El device_token ha expirado.',
      },
    };
  }

  const hostCheck = validateAuthorizedProviderUrl(cfg.serverUrl);
  if (!hostCheck.ok) {
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, mem),
      diagnostic: {
        ok: false,
        category: 'connection_error',
        message: hostCheck.message,
      },
    };
  }

  const template =
    cfg.profileSessionEndpoint?.trim() || '/api/v1/profiles/{profileId}/session';
  const pathCheck = applyTemplatePathSafe(hostCheck.origin, template, {
    profileId,
    id: profileId,
    catalogId: cfg.catalogId,
  });

  if (!pathCheck.ok) {
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, mem),
      diagnostic: {
        ok: false,
        category: 'session_error',
        message: pathCheck.message,
      },
    };
  }

  const authCfg = buildTokenTransportConfig(cfg, mem.deviceToken, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  if (!authCfg.transportConfirmed) {
    const updated: ServerProviderSession = {
      ...mem,
      selectedProfileId: profileId,
      selectedProfileName:
        mem.profiles.find((p) => p.id === profileId)?.name || profileId,
      status: 'pending_config',
      statusMessage:
        'Falta confirmar el mecanismo de envío de tokens (Bearer, cabecera personalizada o query) antes de invocar la creación de sesión de perfil.',
      lastUpdatedAt: Date.now(),
      lastConfig: cfg,
    };
    providerSessions.set(sessionKey, updated);
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, updated),
      diagnostic: {
        ok: false,
        category: 'auth_error',
        message: 'Mecanismo de envío de tokens pendiente de confirmar.',
      },
    };
  }

  const upstreamUrl = authCfg.applyQuery(pathCheck.url);
  const fetchOutcome = await fetchUpstreamWithTimeout(upstreamUrl, {
    method: 'POST',
    headers: authCfg.headers,
    body: JSON.stringify({}),
  });

  if (!fetchOutcome.ok) {
    const updated: ServerProviderSession = {
      ...mem,
      status: 'error',
      statusMessage: fetchOutcome.diagnostic.message,
      lastUpdatedAt: Date.now(),
      lastConfig: cfg,
    };
    providerSessions.set(sessionKey, updated);
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, updated),
      diagnostic: fetchOutcome.diagnostic,
    };
  }

  const res = fetchOutcome.response;
  if (!res.ok) {
    const diag = await classifyHttpFailure(res, 'session', true);
    const updated: ServerProviderSession = {
      ...mem,
      profileToken: undefined,
      status: res.status === 401 || res.status === 403 ? 'expired' : 'error',
      statusMessage: `${diag.message} ${diag.detail || ''}`.trim(),
      lastUpdatedAt: Date.now(),
      lastConfig: cfg,
    };
    providerSessions.set(sessionKey, updated);
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, updated),
      diagnostic: diag,
    };
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    const updated: ServerProviderSession = {
      ...mem,
      status: 'error',
      statusMessage:
        'La respuesta de sesión de perfil no contiene un JSON válido.',
      lastUpdatedAt: Date.now(),
    };
    providerSessions.set(sessionKey, updated);
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, updated),
      diagnostic: {
        ok: false,
        category: 'session_error',
        httpStatus: res.status,
        message: 'Respuesta de sesión no es JSON válido.',
      },
    };
  }

  const profileToken =
    typeof payload.profile_token === 'string'
      ? payload.profile_token
      : typeof payload.profileToken === 'string'
      ? payload.profileToken
      : undefined;

  if (!profileToken) {
    const updated: ServerProviderSession = {
      ...mem,
      status: 'error',
      statusMessage:
        'El endpoint de sesión respondió HTTP 200 pero no devolvió profile_token.',
      lastUpdatedAt: Date.now(),
    };
    providerSessions.set(sessionKey, updated);
    return {
      ok: false,
      sessionView: toSafeSessionView(connectionId, updated),
      diagnostic: {
        ok: false,
        category: 'session_error',
        httpStatus: res.status,
        message: 'Falta profile_token en la respuesta del proveedor.',
      },
    };
  }

  const chosen = mem.profiles.find((p) => p.id === profileId);
  const updated: ServerProviderSession = {
    ...mem,
    profileToken,
    profileTokenExpiresAt: extractJwtExpirationMs(profileToken),
    selectedProfileId: profileId,
    selectedProfileName: chosen?.name || profileId,
    status: 'session_active',
    statusMessage: `Sesión activa en servidor para "${chosen?.name || profileId}". Los tokens permanecen protegidos en memoria del servidor.`,
    lastUpdatedAt: Date.now(),
    lastConfig: cfg,
  };
  providerSessions.set(sessionKey, updated);

  return {
    ok: true,
    sessionView: toSafeSessionView(connectionId, updated),
    diagnostic: {
      ok: true,
      httpStatus: res.status,
      message: 'Sesión de perfil creada correctamente en memoria del servidor.',
    },
  };
}

async function executeAuthenticatedProviderGet(
  sessionKey: string,
  connectionId: string,
  cfg: ProviderRequestConfig,
  endpointTemplate: string,
  vars: Record<string, string | number | undefined>,
  context: 'account' | 'catalog'
): Promise<{
  ok: boolean;
  httpStatus?: number;
  jsonBody?: unknown;
  diagnostic: UpstreamDiagnostic;
}> {
  const hostCheck = validateAuthorizedProviderUrl(cfg.serverUrl);
  if (!hostCheck.ok) {
    return {
      ok: false,
      diagnostic: {
        ok: false,
        category: 'connection_error',
        message: hostCheck.message,
      },
    };
  }

  const pathCheck = applyTemplatePathSafe(hostCheck.origin, endpointTemplate, vars);
  if (!pathCheck.ok) {
    return {
      ok: false,
      diagnostic: {
        ok: false,
        category: context === 'catalog' ? 'catalog_error' : 'provider_http',
        message: pathCheck.message,
      },
    };
  }

  let mem = providerSessions.get(sessionKey);
  const transport = cfg.tokenTransport || 'unconfirmed';

  // Si profile_token expiró y hay device_token vigente, renovar sesión en memoria del servidor
  if (
    mem &&
    mem.selectedProfileId &&
    mem.deviceToken &&
    !isTokenExpired(mem.deviceTokenExpiresAt) &&
    (!mem.profileToken || isTokenExpired(mem.profileTokenExpiresAt)) &&
    transport !== 'unconfirmed'
  ) {
    await performProfileSessionCreation(
      sessionKey,
      connectionId,
      mem.selectedProfileId,
      cfg
    );
    mem = providerSessions.get(sessionKey);
  }

  const preferredSource = cfg.sessionTokenSource || 'profile_token';
  const memToken =
    preferredSource === 'device_token'
      ? mem?.deviceToken || mem?.profileToken
      : mem?.profileToken || mem?.deviceToken;

  const authCfg = buildTokenTransportConfig(cfg, memToken, {
    Accept: 'application/json',
  });
  let targetUrl = authCfg.applyQuery(pathCheck.url);

  let fetchRes = await fetchUpstreamWithTimeout(targetUrl, {
    method: 'GET',
    headers: authCfg.headers,
  });

  if (!fetchRes.ok) {
    return { ok: false, diagnostic: fetchRes.diagnostic };
  }

  let res = fetchRes.response;

  // Reintento único ante HTTP 401/403 si existe device_token válido para renovar profile_token
  if (
    (res.status === 401 || res.status === 403) &&
    mem?.deviceToken &&
    mem.selectedProfileId &&
    !isTokenExpired(mem.deviceTokenExpiresAt) &&
    transport !== 'unconfirmed'
  ) {
    const renewed = await performProfileSessionCreation(
      sessionKey,
      connectionId,
      mem.selectedProfileId,
      cfg
    );
    if (renewed.ok) {
      const latestMem = providerSessions.get(sessionKey);
      const nextToken =
        preferredSource === 'device_token'
          ? latestMem?.deviceToken || latestMem?.profileToken
          : latestMem?.profileToken || latestMem?.deviceToken;
      const retryAuth = buildTokenTransportConfig(cfg, nextToken, {
        Accept: 'application/json',
      });
      targetUrl = retryAuth.applyQuery(pathCheck.url);
      fetchRes = await fetchUpstreamWithTimeout(targetUrl, {
        method: 'GET',
        headers: retryAuth.headers,
      });
      if (!fetchRes.ok) {
        return { ok: false, diagnostic: fetchRes.diagnostic };
      }
      res = fetchRes.response;
    }
  }

  if (!res.ok) {
    const diag = await classifyHttpFailure(res, context, authCfg.transportConfirmed);
    return { ok: false, httpStatus: res.status, diagnostic: diag };
  }

  const rawText = await res.text();
  const trimmed = rawText.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return {
      ok: false,
      httpStatus: res.status,
      diagnostic: {
        ok: false,
        category: context === 'catalog' ? 'catalog_error' : 'provider_http',
        httpStatus: res.status,
        message:
          'El servidor respondió HTTP 200 pero el cuerpo no es JSON válido (posible página HTML o bloqueo del proveedor).',
      },
    };
  }

  try {
    const jsonBody = JSON.parse(trimmed);
    return {
      ok: true,
      httpStatus: res.status,
      jsonBody,
      diagnostic: {
        ok: true,
        httpStatus: res.status,
        message: 'Respuesta JSON verificada correctamente.',
      },
    };
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      diagnostic: {
        ok: false,
        category: context === 'catalog' ? 'catalog_error' : 'provider_http',
        httpStatus: res.status,
        message: 'Error al analizar JSON de respuesta del proveedor.',
      },
    };
  }
}

function extractCatalogArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((x): x is Record<string, unknown> =>
      Boolean(x && typeof x === 'object')
    );
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

function isValidCatalogPayload(payload: unknown): {
  valid: boolean;
  items: Array<Record<string, unknown>>;
} {
  if (
    !payload ||
    (typeof payload !== 'object' && !Array.isArray(payload))
  ) {
    return { valid: false, items: [] };
  }
  const items = extractCatalogArray(payload);
  if (items.length === 0) {
    // Un array vacío [] sí es estructura válida vacía, pero un objeto genérico { error: ... } sin lista NO lo es
    return { valid: Array.isArray(payload), items: [] };
  }
  const sample = items[0];
  const hasFields =
    sample.id !== undefined ||
    sample.stream_id !== undefined ||
    sample.series_id !== undefined;
  const hasName = sample.name !== undefined || sample.title !== undefined;
  return { valid: Boolean(hasFields && hasName), items };
}

function normalizeCatalogItems(
  items: Array<Record<string, unknown>>,
  connectionId: string,
  fallbackType: 'movie' | 'series' | 'live'
) {
  return items.map((raw, idx) => {
    const rawType = raw.type;
    const resolvedType =
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
  });
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  // CORS estricto solo para los dominios autorizados de NEXUS en /api/nexus/*
  app.use('/api/nexus', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!isOriginAuthorizedForBackend(req, origin)) {
        res.status(403).json({
          ok: false,
          errorCategory: 'browser_cors',
          message:
            'Origen no autorizado por la política CORS del backend de NEXUS IPTV.',
        });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Nexus-Session, X-Nexus-Client'
      );
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Handshake de sesión interna autenticada entre React y Express (sin BD)
  app.post('/api/nexus/session/handshake', (req: Request, res: Response) => {
    if (req.get('x-nexus-client') !== 'nexus-iptv-web') {
      res.status(403).json({
        ok: false,
        errorCategory: 'auth_error',
        message: 'Solicitud de cliente no autorizada.',
      });
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const existingSid = verifySignedSid(cookies.nexus_sid);
    const now = Date.now();

    let clientSession = existingSid ? nexusClients.get(existingSid) : undefined;
    if (!clientSession || clientSession.expiresAt <= now) {
      const newSid = randomBytes(24).toString('hex');
      const csrfToken = randomBytes(24).toString('hex');
      clientSession = {
        sid: newSid,
        csrfToken,
        createdAt: now,
        expiresAt: now + CLIENT_TTL_MS,
      };
      nexusClients.set(newSid, clientSession);

      const isHttps =
        req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
      const cookieFlags = [
        `nexus_sid=${encodeURIComponent(signSid(newSid))}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/api/nexus',
        `Max-Age=${Math.floor(CLIENT_TTL_MS / 1000)}`,
        ...(isHttps ? ['Secure'] : []),
      ];
      res.setHeader('Set-Cookie', cookieFlags.join('; '));
    }

    res.json({
      ok: true,
      sessionToken: clientSession.csrfToken,
      authorizedProviderHosts: Array.from(AUTHORIZED_PROVIDER_HOSTS),
    });
  });

  // Middleware de protección para todas las rutas internas de proveedores
  const requireNexusSession = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = verifySignedSid(cookies.nexus_sid);
    const headerToken = req.get('x-nexus-session');

    if (!sid || !headerToken) {
      res.status(401).json({
        ok: false,
        errorCategory: 'session_error',
        message: 'Sesión segura de NEXUS requerida para acceder a los endpoints internos.',
      });
      return;
    }

    const client = nexusClients.get(sid);
    if (!client || client.expiresAt <= Date.now()) {
      res.status(401).json({
        ok: false,
        errorCategory: 'session_error',
        message: 'La sesión interna de NEXUS ha expirado.',
      });
      return;
    }

    if (!safeCompareTokens(client.csrfToken, headerToken)) {
      res.status(403).json({
        ok: false,
        errorCategory: 'auth_error',
        message: 'Token de sesión interna inválido.',
      });
      return;
    }

    const connectionId = req.params.connectionId;
    if (connectionId && !/^[a-zA-Z0-9_-]{1,80}$/.test(connectionId)) {
      res.status(400).json({
        ok: false,
        errorCategory: 'connection_error',
        message: 'Identificador de conexión inválido.',
      });
      return;
    }

    res.locals.nexusSid = sid;
    next();
  };

  // Consultar estado seguro de sesión (sin exponer tokens)
  app.get(
    '/api/nexus/providers/:connectionId/session',
    requireNexusSession,
    (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      const mem = providerSessions.get(`${sid}::${connectionId}`);
      res.json({
        ok: true,
        session: toSafeSessionView(connectionId, mem),
      });
    }
  );

  // Cerrar sesión y borrar tokens temporales en memoria del servidor
  app.delete(
    '/api/nexus/providers/:connectionId/session',
    requireNexusSession,
    (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      providerSessions.delete(`${sid}::${connectionId}`);
      res.json({
        ok: true,
        session: toSafeSessionView(connectionId, undefined),
      });
    }
  );

  // Paso 1-2 Netsky: Login IPTV (guarda device_token estrictamente en RAM del servidor)
  app.post(
    '/api/nexus/providers/:connectionId/login-iptv',
    requireNexusSession,
    async (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      const sessionKey = `${sid}::${connectionId}`;
      const body = (req.body || {}) as {
        serverUrl?: string;
        catalogId?: string;
        username?: string;
        password?: string;
        loginIptvEndpoint?: string;
        loginIptvMethod?: 'POST' | 'GET';
        profileSessionEndpoint?: string;
        tokenTransport?: TokenTransportMechanism;
        sessionTokenSource?: 'profile_token' | 'device_token';
        tokenQueryParam?: string;
        authHeaderName?: string;
        tokenPrefix?: string;
      };

      const hostCheck = validateAuthorizedProviderUrl(body.serverUrl);
      if (!hostCheck.ok) {
        res.status(hostCheck.code).json({
          ok: false,
          errorCategory:
            hostCheck.category === 'provider_not_authorized'
              ? 'provider_http'
              : hostCheck.category,
          message: hostCheck.message,
          session: toSafeSessionView(connectionId, providerSessions.get(sessionKey)),
        });
        return;
      }

      const route = body.loginIptvEndpoint?.trim();
      if (!route) {
        const pendingState: ServerProviderSession = {
          key: sessionKey,
          connectionId,
          profiles: [],
          status: 'pending_config',
          statusMessage:
            'La ruta de login-iptv aún no está configurada. Configúrala sin inventar endpoints.',
          lastUpdatedAt: Date.now(),
        };
        providerSessions.set(sessionKey, pendingState);
        res.json({
          ok: false,
          errorCategory: 'auth_error',
          session: toSafeSessionView(connectionId, pendingState),
          diagnostic: {
            ok: false,
            category: 'auth_error',
            message: 'Ruta login-iptv pendiente de configurar.',
          },
        });
        return;
      }

      if (!body.username?.trim() || !body.password) {
        const errState: ServerProviderSession = {
          key: sessionKey,
          connectionId,
          profiles: [],
          status: 'error',
          statusMessage:
            'Ingresa usuario y contraseña antes de autenticar mediante login-iptv.',
          lastUpdatedAt: Date.now(),
        };
        providerSessions.set(sessionKey, errState);
        res.status(400).json({
          ok: false,
          errorCategory: 'auth_error',
          session: toSafeSessionView(connectionId, errState),
          diagnostic: {
            ok: false,
            category: 'auth_error',
            message: 'Faltan usuario o contraseña.',
          },
        });
        return;
      }

      const pathCheck = applyTemplatePathSafe(hostCheck.origin, route, {
        catalogId: body.catalogId,
        username: body.username.trim(),
      });
      if (!pathCheck.ok) {
        res.status(400).json({
          ok: false,
          errorCategory: 'auth_error',
          message: pathCheck.message,
        });
        return;
      }

      const method = body.loginIptvMethod === 'GET' ? 'GET' : 'POST';
      const upstream = await fetchUpstreamWithTimeout(pathCheck.url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          method === 'POST'
            ? JSON.stringify({
                username: body.username.trim(),
                password: body.password,
                ...(body.catalogId?.trim() ? { catalogId: body.catalogId.trim() } : {}),
              })
            : undefined,
      });

      // Descartar referencia a contraseña en memoria inmediatamente tras envío
      body.password = undefined;

      if (!upstream.ok) {
        const errState: ServerProviderSession = {
          key: sessionKey,
          connectionId,
          profiles: [],
          status: 'error',
          statusMessage: upstream.diagnostic.message,
          lastUpdatedAt: Date.now(),
        };
        providerSessions.set(sessionKey, errState);
        res.json({
          ok: false,
          errorCategory: upstream.diagnostic.category,
          session: toSafeSessionView(connectionId, errState),
          diagnostic: upstream.diagnostic,
        });
        return;
      }

      const upstreamRes = upstream.response;
      if (!upstreamRes.ok) {
        const diag = await classifyHttpFailure(upstreamRes, 'auth', true);
        const errState: ServerProviderSession = {
          key: sessionKey,
          connectionId,
          profiles: [],
          status: 'error',
          statusMessage: `${diag.message} ${diag.detail || ''}`.trim(),
          lastUpdatedAt: Date.now(),
        };
        providerSessions.set(sessionKey, errState);
        res.json({
          ok: false,
          errorCategory: diag.category,
          session: toSafeSessionView(connectionId, errState),
          diagnostic: diag,
        });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = (await upstreamRes.json()) as Record<string, unknown>;
      } catch {
        const errState: ServerProviderSession = {
          key: sessionKey,
          connectionId,
          profiles: [],
          status: 'error',
          statusMessage: 'La respuesta de login-iptv no es JSON válido.',
          lastUpdatedAt: Date.now(),
        };
        providerSessions.set(sessionKey, errState);
        res.json({
          ok: false,
          errorCategory: 'auth_error',
          session: toSafeSessionView(connectionId, errState),
          diagnostic: {
            ok: false,
            category: 'auth_error',
            httpStatus: upstreamRes.status,
            message: 'Respuesta de login-iptv inválida (no JSON).',
          },
        });
        return;
      }

      const deviceToken =
        typeof payload.device_token === 'string'
          ? payload.device_token
          : typeof payload.deviceToken === 'string'
          ? payload.deviceToken
          : undefined;
      const profiles = normalizeProfilesList(payload.profiles);
      const accountSummary = sanitizeAccountRecord(payload.account);

      if (!deviceToken) {
        const errState: ServerProviderSession = {
          key: sessionKey,
          connectionId,
          accountSummary,
          profiles,
          status: 'error',
          statusMessage:
            'El servidor respondió HTTP 200 pero no incluyó device_token.',
          lastUpdatedAt: Date.now(),
        };
        providerSessions.set(sessionKey, errState);
        res.json({
          ok: false,
          errorCategory: 'auth_error',
          session: toSafeSessionView(connectionId, errState),
          diagnostic: {
            ok: false,
            category: 'auth_error',
            httpStatus: upstreamRes.status,
            message: 'Falta device_token en la respuesta de login-iptv.',
          },
        });
        return;
      }

      const savedSession: ServerProviderSession = {
        key: sessionKey,
        connectionId,
        deviceToken,
        deviceTokenExpiresAt: extractJwtExpirationMs(deviceToken),
        accountSummary,
        profiles,
        status: 'device_authenticated',
        statusMessage:
          profiles.length > 0
            ? `Autenticación completada en servidor (${profiles.length} perfiles). Selecciona un perfil para crear la sesión.`
            : 'Autenticación de dispositivo completada en servidor (sin perfiles listados).',
        lastUpdatedAt: Date.now(),
        lastConfig: {
          serverUrl: hostCheck.origin,
          catalogId: body.catalogId,
          profileSessionEndpoint: body.profileSessionEndpoint,
          tokenTransport: body.tokenTransport,
          sessionTokenSource: body.sessionTokenSource,
          tokenQueryParam: body.tokenQueryParam,
          authHeaderName: body.authHeaderName,
          tokenPrefix: body.tokenPrefix,
        },
      };
      providerSessions.set(sessionKey, savedSession);

      res.json({
        ok: true,
        session: toSafeSessionView(connectionId, savedSession),
        diagnostic: {
          ok: true,
          httpStatus: upstreamRes.status,
          message: 'device_token recibido y protegido en memoria del servidor.',
        },
      });
    }
  );

  // Paso 3-4 Netsky: Crear/renovar sesión de perfil mediante POST con cuerpo {}
  app.post(
    '/api/nexus/providers/:connectionId/profile-session',
    requireNexusSession,
    async (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      const sessionKey = `${sid}::${connectionId}`;
      const body = (req.body || {}) as ProviderRequestConfig & {
        profileId?: string;
      };

      const profileId =
        body.profileId?.trim() ||
        providerSessions.get(sessionKey)?.selectedProfileId;

      if (!profileId) {
        res.status(400).json({
          ok: false,
          errorCategory: 'session_error',
          message: 'Debes seleccionar un perfil válido.',
          session: toSafeSessionView(connectionId, providerSessions.get(sessionKey)),
        });
        return;
      }

      const outcome = await performProfileSessionCreation(
        sessionKey,
        connectionId,
        profileId,
        body
      );
      res.json({
        ok: outcome.ok,
        errorCategory: outcome.diagnostic.category,
        session: outcome.sessionView,
        diagnostic: outcome.diagnostic,
      });
    }
  );

  // Consultar información de cuenta (ej. /api/player/catalog/{catalogId}/account)
  app.post(
    '/api/nexus/providers/:connectionId/account',
    requireNexusSession,
    async (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      const sessionKey = `${sid}::${connectionId}`;
      const body = (req.body || {}) as ProviderRequestConfig & {
        endpointTemplate?: string;
      };

      const template =
        body.endpointTemplate?.trim() ||
        (body.catalogId?.trim() ? '/api/player/catalog/{catalogId}/account' : '');
      if (!template) {
        res.status(400).json({
          ok: false,
          errorCategory: 'provider_http',
          message: 'Falta la ruta de cuenta o el catalogId.',
        });
        return;
      }

      const result = await executeAuthenticatedProviderGet(
        sessionKey,
        connectionId,
        body,
        template,
        { catalogId: body.catalogId?.trim() },
        'account'
      );

      if (!result.ok) {
        res.json({
          ok: false,
          errorCategory: result.diagnostic.category,
          diagnostic: result.diagnostic,
        });
        return;
      }

      const rec =
        result.jsonBody &&
        typeof result.jsonBody === 'object' &&
        !Array.isArray(result.jsonBody)
          ? (result.jsonBody as Record<string, unknown>)
          : null;

      if (!rec || Object.keys(rec).length === 0) {
        res.json({
          ok: false,
          errorCategory: 'catalog_error',
          diagnostic: {
            ok: false,
            category: 'catalog_error',
            httpStatus: result.httpStatus,
            message: 'El endpoint de cuenta devolvió un objeto JSON vacío o inválido.',
          },
        });
        return;
      }

      const safeSummary = sanitizeAccountRecord(rec);
      res.json({
        ok: true,
        accountInfo: {
          status: String(rec.status || rec.state || 'Activo'),
          expDate: rec.expiresAt
            ? String(rec.expiresAt)
            : rec.expDate
            ? String(rec.expDate)
            : undefined,
          rawSummary: safeSummary
            ? Object.entries(safeSummary)
                .slice(0, 4)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(' · ')
            : undefined,
        },
        diagnostic: result.diagnostic,
      });
    }
  );

  // Consultar catálogo (películas, series o canales) desde el backend sin exponer tokens
  app.post(
    '/api/nexus/providers/:connectionId/catalog',
    requireNexusSession,
    async (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      const sessionKey = `${sid}::${connectionId}`;
      const body = (req.body || {}) as ProviderRequestConfig & {
        mediaType?: 'movie' | 'series' | 'live';
        endpointTemplate?: string;
      };

      const mediaType =
        body.mediaType === 'series' || body.mediaType === 'live'
          ? body.mediaType
          : 'movie';

      const defaultNetskyTemplate =
        mediaType === 'movie' && body.catalogId?.trim()
          ? '/api/player/catalog/{catalogId}/items?type=movie'
          : mediaType === 'series' && body.catalogId?.trim()
          ? '/api/player/catalog/{catalogId}/items?type=series'
          : '';

      const template = body.endpointTemplate?.trim() || defaultNetskyTemplate;
      if (!template) {
        res.status(400).json({
          ok: false,
          errorCategory: 'catalog_error',
          items: [],
          diagnostic: {
            ok: false,
            category: 'catalog_error',
            message: `Ruta de catálogo para ${mediaType} no configurada.`,
          },
        });
        return;
      }

      const result = await executeAuthenticatedProviderGet(
        sessionKey,
        connectionId,
        body,
        template,
        { catalogId: body.catalogId?.trim(), type: mediaType },
        'catalog'
      );

      if (!result.ok) {
        res.json({
          ok: false,
          errorCategory: result.diagnostic.category,
          items: [],
          diagnostic: result.diagnostic,
        });
        return;
      }

      const validation = isValidCatalogPayload(result.jsonBody);
      if (!validation.valid) {
        res.json({
          ok: false,
          errorCategory: 'catalog_error',
          items: [],
          diagnostic: {
            ok: false,
            category: 'catalog_error',
            httpStatus: result.httpStatus,
            message:
              'HTTP 200 recibido pero la respuesta no coincide con una estructura válida de catálogo (id, name).',
          },
        });
        return;
      }

      const normalized = normalizeCatalogItems(
        validation.items,
        connectionId,
        mediaType
      );
      res.json({
        ok: true,
        items: normalized,
        diagnostic: {
          ok: true,
          httpStatus: result.httpStatus,
          message: `Catálogo ${mediaType} verificado (${normalized.length} elementos).`,
        },
      });
    }
  );

  // Consultar endpoints configurados opcionales (detalles, episodios, reproducción)
  app.post(
    '/api/nexus/providers/:connectionId/query',
    requireNexusSession,
    async (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      const sessionKey = `${sid}::${connectionId}`;
      const body = (req.body || {}) as ProviderRequestConfig & {
        endpointTemplate?: string;
        vars?: Record<string, string | number | undefined>;
      };

      if (!body.endpointTemplate?.trim()) {
        res.status(400).json({
          ok: false,
          errorCategory: 'provider_http',
          message: 'Endpoint no configurado.',
        });
        return;
      }

      const result = await executeAuthenticatedProviderGet(
        sessionKey,
        connectionId,
        body,
        body.endpointTemplate,
        body.vars || {},
        'catalog'
      );

      if (!result.ok) {
        res.json({
          ok: false,
          errorCategory: result.diagnostic.category,
          diagnostic: result.diagnostic,
        });
        return;
      }

      res.json({
        ok: true,
        data: result.jsonBody,
        diagnostic: result.diagnostic,
      });
    }
  );

  // Diagnóstico completo servidor-a-servidor para Netsky / proveedores autorizados
  app.post(
    '/api/nexus/providers/:connectionId/diagnose',
    requireNexusSession,
    async (req: Request, res: Response) => {
      const sid = String(res.locals.nexusSid);
      const connectionId = String(req.params.connectionId);
      const sessionKey = `${sid}::${connectionId}`;
      const body = (req.body || {}) as ProviderRequestConfig & {
        accountEndpoint?: string;
        moviesEndpoint?: string;
        seriesEndpoint?: string;
        liveEndpoint?: string;
        loginIptvEndpoint?: string;
        authEndpoint?: string;
      };

      const mem = providerSessions.get(sessionKey);
      const catId = body.catalogId?.trim();
      const accountTpl =
        body.accountEndpoint?.trim() ||
        (catId ? '/api/player/catalog/{catalogId}/account' : '');
      const moviesTpl =
        body.moviesEndpoint?.trim() ||
        (catId ? '/api/player/catalog/{catalogId}/items?type=movie' : '');
      const seriesTpl =
        body.seriesEndpoint?.trim() ||
        (catId ? '/api/player/catalog/{catalogId}/items?type=series' : '');

      const accountRes = accountTpl
        ? await executeAuthenticatedProviderGet(
            sessionKey,
            connectionId,
            body,
            accountTpl,
            { catalogId: catId },
            'account'
          )
        : null;

      const moviesRes = moviesTpl
        ? await executeAuthenticatedProviderGet(
            sessionKey,
            connectionId,
            body,
            moviesTpl,
            { catalogId: catId, type: 'movie' },
            'catalog'
          )
        : null;

      const seriesRes = seriesTpl
        ? await executeAuthenticatedProviderGet(
            sessionKey,
            connectionId,
            body,
            seriesTpl,
            { catalogId: catId, type: 'series' },
            'catalog'
          )
        : null;

      const moviesCheck = moviesRes?.ok
        ? isValidCatalogPayload(moviesRes.jsonBody)
        : { valid: false, items: [] };
      const seriesCheck = seriesRes?.ok
        ? isValidCatalogPayload(seriesRes.jsonBody)
        : { valid: false, items: [] };

      let accountInfo: Record<string, unknown> | undefined = undefined;
      let accountValid = false;
      if (
        accountRes?.ok &&
        accountRes.jsonBody &&
        typeof accountRes.jsonBody === 'object' &&
        !Array.isArray(accountRes.jsonBody)
      ) {
        const rec = accountRes.jsonBody as Record<string, unknown>;
        if (Object.keys(rec).length > 0) {
          accountValid = true;
          const safe = sanitizeAccountRecord(rec);
          accountInfo = {
            status: String(rec.status || rec.state || 'Activo'),
            expDate: rec.expiresAt
              ? String(rec.expiresAt)
              : rec.expDate
              ? String(rec.expDate)
              : undefined,
            rawSummary: safe
              ? Object.entries(safe)
                  .slice(0, 4)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(' · ')
              : undefined,
          };
        }
      }

      res.json({
        ok: true,
        session: toSafeSessionView(connectionId, mem),
        account: accountRes
          ? {
              ok: accountValid,
              httpStatus: accountRes.httpStatus,
              accountInfo,
              diagnostic: accountValid
                ? accountRes.diagnostic
                : accountRes.ok
                ? {
                    ok: false,
                    category: 'catalog_error',
                    httpStatus: accountRes.httpStatus,
                    message: 'Respuesta de cuenta vacía o sin estructura válida.',
                  }
                : accountRes.diagnostic,
            }
          : null,
        movies: moviesRes
          ? {
              ok: moviesCheck.valid,
              httpStatus: moviesRes.httpStatus,
              count: moviesCheck.items.length,
              formats: Array.from(
                new Set(
                  moviesCheck.items
                    .slice(0, 100)
                    .map((i) =>
                      String(i.containerExtension ?? i.container_extension ?? '')
                        .trim()
                        .toLowerCase()
                    )
                    .filter(Boolean)
                )
              ),
              diagnostic: moviesCheck.valid
                ? moviesRes.diagnostic
                : moviesRes.ok
                ? {
                    ok: false,
                    category: 'catalog_error',
                    httpStatus: moviesRes.httpStatus,
                    message:
                      'HTTP 200 en películas, pero el JSON no coincide con el esquema esperado (id, name).',
                  }
                : moviesRes.diagnostic,
            }
          : null,
        series: seriesRes
          ? {
              ok: seriesCheck.valid,
              httpStatus: seriesRes.httpStatus,
              count: seriesCheck.items.length,
              formats: Array.from(
                new Set(
                  seriesCheck.items
                    .slice(0, 100)
                    .map((i) =>
                      String(i.containerExtension ?? i.container_extension ?? '')
                        .trim()
                        .toLowerCase()
                    )
                    .filter(Boolean)
                )
              ),
              diagnostic: seriesCheck.valid
                ? seriesRes.diagnostic
                : seriesRes.ok
                ? {
                    ok: false,
                    category: 'catalog_error',
                    httpStatus: seriesRes.httpStatus,
                    message:
                      'HTTP 200 en series, pero el JSON no coincide con el esquema esperado (id, name).',
                  }
                : seriesRes.diagnostic,
            }
          : null,
      });
    }
  );

  // Fallback JSON 404 para cualquier /api/nexus/* desconocido
  app.use('/api/nexus', (_req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      errorCategory: 'provider_http',
      message: 'Ruta de API NEXUS no encontrada.',
    });
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build no encontrado. Ejecuta npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NEXUS IPTV escuchando en http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error(
    'Error al iniciar servidor NEXUS IPTV:',
    err instanceof Error ? err.message : 'Error desconocido'
  );
  process.exit(1);
});
