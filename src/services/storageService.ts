import {
  AppBackupData,
  CachedCatalog,
  CatalogItem,
  FavoriteItem,
  IptvConnection,
  PlaybackProgress,
  UserPreferences,
  WatchHistoryEntry,
} from '../types/iptv';

const STORAGE_KEYS = {
  CONNECTIONS: 'nexus_iptv_connections',
  ACTIVE_CONNECTION_ID: 'nexus_iptv_active_connection_id',
  FAVORITES: 'nexus_iptv_favorites',
  HISTORY: 'nexus_iptv_history',
  PROGRESS: 'nexus_iptv_progress',
  PREFERENCES: 'nexus_iptv_preferences',
  CACHE_PREFIX: 'nexus_iptv_catalog_cache_',
  INITIALIZED_DEFAULTS: 'nexus_iptv_initialized_defaults_v1',
} as const;

// Caché de secretos únicamente en memoria de la sesión actual cuando el usuario no desea guardarlos en LocalStorage
const sessionSecretsMap = new Map<string, { password?: string; token?: string }>();

export const DEFAULT_PREFERENCES: UserPreferences = {
  autoPlayNextEpisode: true,
  preferHls: true,
  defaultVolume: 0.85,
  catalogPageSize: 36,
  enableLocalCache: true,
  showFormatBadgesInDetail: true,
};

export function createInitialNetskyConnection(): IptvConnection {
  const now = Date.now();
  return {
    id: 'conn-netsky-initial',
    name: 'Netsky',
    type: 'custom_api',
    preset: 'netsky',
    communicationMode: 'backend_secure',
    serverUrl: 'https://v3kt-orbe.zenbu.fans',
    catalogId: '04d80271-437e-4e9f-bc85-879f1910bb89',
    customEndpoints: {
      loginIptvMethod: 'POST',
      profileSessionEndpoint: '/api/v1/profiles/{profileId}/session',
      tokenTransport: 'unconfirmed',
      sessionTokenSource: 'profile_token',
      accountEndpoint: '/api/player/catalog/{catalogId}/account',
      moviesEndpoint: '/api/player/catalog/{catalogId}/items?type=movie',
      seriesEndpoint: '/api/player/catalog/{catalogId}/items?type=series',
      authHeaderName: 'Authorization',
      tokenPrefix: 'Bearer',
    },
    status: 'pending_config',
    statusMessage:
      'Configuración inicial de Netsky (capa segura Express activa para evitar CORS de navegador). Ruta login-iptv, mecanismo de envío de tokens, detalles y reproducción pendientes.',
    capabilities: {
      auth: false,
      account: true,
      liveTv: false,
      movies: true,
      series: true,
      details: false,
      seasonsAndEpisodes: false,
      playback: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadConnections(): IptvConnection[] {
  const stored = safeReadJson<IptvConnection[]>(STORAGE_KEYS.CONNECTIONS, []);
  const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED_DEFAULTS);

  if (!initialized && stored.length === 0) {
    const initialNetsky = createInitialNetskyConnection();
    safeWriteJson(STORAGE_KEYS.CONNECTIONS, [initialNetsky]);
    localStorage.setItem(STORAGE_KEYS.INITIALIZED_DEFAULTS, '1');
    localStorage.setItem(STORAGE_KEYS.ACTIVE_CONNECTION_ID, initialNetsky.id);
    return [initialNetsky];
  }

  if (!initialized) {
    localStorage.setItem(STORAGE_KEYS.INITIALIZED_DEFAULTS, '1');
  }

  return stored.map((conn) => {
    const mem = sessionSecretsMap.get(conn.id);
    if (!mem) return conn;
    return {
      ...conn,
      password: conn.password || mem.password,
      token: conn.token || mem.token,
    };
  });
}

export function saveConnections(connections: IptvConnection[]): void {
  const sanitizedForStorage = connections.map((conn) => {
    if (conn.password || conn.token) {
      sessionSecretsMap.set(conn.id, {
        password: conn.password,
        token: conn.token,
      });
    } else {
      sessionSecretsMap.delete(conn.id);
    }

    if (conn.rememberSecretsInBrowser) {
      return conn;
    }

    // No guardar contraseñas ni tokens en LocalStorage cuando el usuario no ha optado explícitamente por recordarlos
    return {
      ...conn,
      password: undefined,
      token: undefined,
    };
  });

  safeWriteJson(STORAGE_KEYS.CONNECTIONS, sanitizedForStorage);
}

export function loadActiveConnectionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_CONNECTION_ID);
  } catch {
    return null;
  }
}

export function saveActiveConnectionId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_CONNECTION_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONNECTION_ID);
    }
  } catch {
    // Ignorar error de cuota
  }
}

export function makeItemKey(connectionId: string, type: string, id: string): string {
  return `${connectionId}::${type}::${id}`;
}

export function loadFavorites(): FavoriteItem[] {
  return safeReadJson<FavoriteItem[]>(STORAGE_KEYS.FAVORITES, []);
}

export function saveFavorites(favorites: FavoriteItem[]): void {
  safeWriteJson(STORAGE_KEYS.FAVORITES, favorites);
}

export function toggleFavoriteItem(
  current: FavoriteItem[],
  item: CatalogItem
): FavoriteItem[] {
  const key = makeItemKey(item.connectionId, item.type, item.id);
  const exists = current.some((f) => f.key === key);
  const updated = exists
    ? current.filter((f) => f.key !== key)
    : [{ key, item, addedAt: Date.now() }, ...current];
  saveFavorites(updated);
  return updated;
}

export function loadHistory(): WatchHistoryEntry[] {
  return safeReadJson<WatchHistoryEntry[]>(STORAGE_KEYS.HISTORY, []);
}

export function saveHistory(history: WatchHistoryEntry[]): void {
  safeWriteJson(STORAGE_KEYS.HISTORY, history);
}

export function recordHistoryEntry(
  current: WatchHistoryEntry[],
  entry: Omit<WatchHistoryEntry, 'key' | 'watchedAt'>
): WatchHistoryEntry[] {
  const key = entry.episodeId
    ? `${entry.connectionId}::${entry.type}::${entry.itemId}::ep::${entry.episodeId}`
    : `${entry.connectionId}::${entry.type}::${entry.itemId}`;
  const filtered = current.filter((h) => h.key !== key);
  const next: WatchHistoryEntry[] = [
    { ...entry, key, watchedAt: Date.now() },
    ...filtered,
  ].slice(0, 120);
  saveHistory(next);
  return next;
}

export function loadProgressMap(): Record<string, PlaybackProgress> {
  return safeReadJson<Record<string, PlaybackProgress>>(STORAGE_KEYS.PROGRESS, {});
}

export function saveProgressMap(map: Record<string, PlaybackProgress>): void {
  safeWriteJson(STORAGE_KEYS.PROGRESS, map);
}

export function makeProgressKey(
  connectionId: string,
  type: string,
  itemId: string,
  episodeId?: string
): string {
  return episodeId
    ? `${connectionId}::${type}::${itemId}::ep::${episodeId}`
    : `${connectionId}::${type}::${itemId}`;
}

export function loadPreferences(): UserPreferences {
  const stored = safeReadJson<Partial<UserPreferences>>(
    STORAGE_KEYS.PREFERENCES,
    {}
  );
  return { ...DEFAULT_PREFERENCES, ...stored };
}

export function savePreferences(prefs: UserPreferences): void {
  safeWriteJson(STORAGE_KEYS.PREFERENCES, prefs);
}

const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutos

export function loadCachedCatalog(connectionId: string): CachedCatalog | null {
  const cached = safeReadJson<CachedCatalog | null>(
    `${STORAGE_KEYS.CACHE_PREFIX}${connectionId}`,
    null
  );
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > CACHE_TTL_MS) {
    return null;
  }
  return cached;
}

export function saveCachedCatalog(catalog: CachedCatalog): void {
  try {
    const serialized = JSON.stringify(catalog);
    if (serialized.length > 3_500_000) {
      return;
    }
    localStorage.setItem(
      `${STORAGE_KEYS.CACHE_PREFIX}${catalog.connectionId}`,
      serialized
    );
  } catch {
    // Ignorar error de cuota
  }
}

export function clearCatalogCache(connectionId?: string): void {
  try {
    if (connectionId) {
      localStorage.removeItem(`${STORAGE_KEYS.CACHE_PREFIX}${connectionId}`);
      return;
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_KEYS.CACHE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignorar
  }
}

export function buildBackupPayload(includeSecrets: boolean): AppBackupData {
  const connections = loadConnections().map((conn) =>
    includeSecrets
      ? conn
      : {
          ...conn,
          password: undefined,
          token: undefined,
        }
  );

  return {
    app: 'NEXUS IPTV',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    includesSecrets: includeSecrets,
    connections,
    activeConnectionId: loadActiveConnectionId(),
    favorites: loadFavorites(),
    history: loadHistory(),
    progress: loadProgressMap(),
    preferences: loadPreferences(),
  };
}

export function parseAndApplyBackup(rawJson: string): {
  ok: boolean;
  message: string;
  data?: AppBackupData;
} {
  try {
    const parsed = JSON.parse(rawJson) as Partial<AppBackupData>;
    if (parsed.app !== 'NEXUS IPTV' || !Array.isArray(parsed.connections)) {
      return {
        ok: false,
        message:
          'El archivo JSON no corresponde a un respaldo válido de NEXUS IPTV.',
      };
    }

    localStorage.setItem(STORAGE_KEYS.INITIALIZED_DEFAULTS, '1');
    saveConnections(parsed.connections);
    if (parsed.activeConnectionId !== undefined) {
      saveActiveConnectionId(parsed.activeConnectionId);
    }
    if (Array.isArray(parsed.favorites)) {
      saveFavorites(parsed.favorites);
    }
    if (Array.isArray(parsed.history)) {
      saveHistory(parsed.history);
    }
    if (parsed.progress && typeof parsed.progress === 'object') {
      saveProgressMap(parsed.progress);
    }
    if (parsed.preferences && typeof parsed.preferences === 'object') {
      savePreferences({ ...DEFAULT_PREFERENCES, ...parsed.preferences });
    }

    clearCatalogCache();

    return {
      ok: true,
      message: `Configuración importada correctamente (${parsed.connections.length} conexiones).`,
      data: parsed as AppBackupData,
    };
  } catch {
    return {
      ok: false,
      message: 'No se pudo analizar el archivo JSON. Verifica que su formato sea válido.',
    };
  }
}
