export type ProviderType = 'xtream' | 'm3u' | 'custom_api';

export type ConnectionInputType = 'auto' | ProviderType;

export type ProviderPreset =
  | 'xtream_standard'
  | 'netsky'
  | 'kaelus'
  | 'm3u_url'
  | 'm3u_file'
  | 'custom_generic';

export type ConnectionStatus =
  | 'untested'
  | 'connected'
  | 'pending_config'
  | 'cors_error'
  | 'auth_error'
  | 'network_error';

export type MediaType = 'movie' | 'series' | 'live';

export type NavSection =
  | 'home'
  | 'live'
  | 'movies'
  | 'series'
  | 'mylist'
  | 'history'
  | 'connections'
  | 'diagnostics'
  | 'settings';

export type TokenTransportMechanism =
  | 'unconfirmed'
  | 'bearer_header'
  | 'custom_header'
  | 'query_param';

export interface CustomEndpointsConfig {
  /** Ruta de autenticación login-iptv (no inventar; mantener configurable) */
  loginIptvEndpoint?: string;
  /** Método HTTP para login-iptv */
  loginIptvMethod?: 'POST' | 'GET';
  /** Ruta de creación de sesión de perfil (POST /api/v1/profiles/{profileId}/session) */
  profileSessionEndpoint?: string;
  /** Mecanismo de envío de token para catálogos y sesiones (configurable hasta confirmar) */
  tokenTransport?: TokenTransportMechanism;
  /** Token de sesión preferido para consultas de catálogo */
  sessionTokenSource?: 'profile_token' | 'device_token';
  /** Nombre del parámetro query si tokenTransport === 'query_param' */
  tokenQueryParam?: string;
  /** Ruta de autenticación genérica (opcional / pendiente si no se conoce) */
  authEndpoint?: string;
  /** Ruta de información de cuenta (en Netsky: /api/player/catalog/{catalogId}/account) */
  accountEndpoint?: string;
  /** Ruta de catálogo de películas. En Netsky: /api/player/catalog/{catalogId}/items?type=movie */
  moviesEndpoint?: string;
  /** Ruta de catálogo de series. En Netsky: /api/player/catalog/{catalogId}/items?type=series */
  seriesEndpoint?: string;
  /** Ruta de canales en vivo */
  liveEndpoint?: string;
  /** Ruta de detalles de título (soporta {id}, {type}, {catalogId}) */
  detailsEndpoint?: string;
  /** Ruta de temporadas de serie (soporta {id}, {seriesId}, {catalogId}) */
  seasonsEndpoint?: string;
  /** Ruta de episodios de serie (soporta {id}, {seriesId}, {seasonNumber}, {catalogId}) */
  episodesEndpoint?: string;
  /** Ruta de fuente de reproducción (soporta {id}, {type}, {episodeId}, {catalogId}) */
  playbackEndpoint?: string;
  /** Nombre de cabecera para enviar token si aplica (ej. Authorization, X-API-Key) */
  authHeaderName?: string;
  /** Prefijo para token en cabecera (ej. Bearer) */
  tokenPrefix?: string;
}

export interface NetskyProfile {
  id: string;
  name: string;
  avatar?: string;
  isDefault?: boolean;
  isKids?: boolean;
  rawMeta?: Record<string, string | number | boolean>;
}

export type NetskySessionStatus =
  | 'logged_out'
  | 'device_authenticated'
  | 'session_active'
  | 'expired'
  | 'pending_config'
  | 'error';

export interface NetskySafeSessionView {
  connectionId: string;
  status: NetskySessionStatus;
  hasDeviceToken: boolean;
  hasProfileToken: boolean;
  deviceTokenExpiresAt?: number;
  profileTokenExpiresAt?: number;
  accountSummary?: Record<string, string | number | boolean>;
  profiles: NetskyProfile[];
  selectedProfileId?: string;
  selectedProfileName?: string;
  statusMessage?: string;
  lastUpdatedAt?: number;
}

export interface ProviderCapabilities {
  auth: boolean;
  account: boolean;
  liveTv: boolean;
  movies: boolean;
  series: boolean;
  details: boolean;
  seasonsAndEpisodes: boolean;
  playback: boolean;
}

export interface ProviderAccountInfo {
  username?: string;
  status?: string;
  expDate?: string;
  isTrial?: boolean;
  activeConnections?: string;
  maxConnections?: string;
  allowedOutputFormats?: string[];
  serverTimezone?: string;
  rawSummary?: string;
}

export type EndpointProbeStatus =
  | 'compatible'
  | 'not_found'
  | 'auth_required'
  | 'cors_error'
  | 'server_error'
  | 'pending_config';

export interface EndpointProbeResult {
  id: string;
  endpoint: string;
  method: 'GET' | 'POST';
  status: EndpointProbeStatus;
  httpCode: string;
  detectedDataType: string;
  validationResult: string;
  sampleCount?: number;
  discoveredFormats?: string[];
}

export type DiagnosticDimensionState =
  | 'ok'
  | 'warning'
  | 'pending'
  | 'error';

export interface DiagnosticDimension {
  key:
    | 'connectivity'
    | 'auth'
    | 'movies'
    | 'series'
    | 'details'
    | 'seasons'
    | 'player';
  label: string;
  state: DiagnosticDimensionState;
  summary: string;
  detail?: string;
}

export type DiagnosticErrorCategory =
  | 'browser_cors'
  | 'connection_error'
  | 'provider_http'
  | 'auth_error'
  | 'session_error'
  | 'catalog_error';

export interface CategorizedDiagnosticItem {
  category: DiagnosticErrorCategory;
  label: string;
  hasError: boolean;
  status: DiagnosticDimensionState;
  summary: string;
  detail?: string;
  httpCode?: string;
}

export interface DiscoveryReport {
  id: string;
  testedAt: number;
  inputUrl: string;
  normalizedUrl: string;
  protocol: string;
  domain: string;
  requestedType: ConnectionInputType;
  detectedType: ProviderType;
  detectedPreset: ProviderPreset;
  suggestedEndpoints: CustomEndpointsConfig;
  suggestedCapabilities: ProviderCapabilities;
  accountInfo?: ProviderAccountInfo;
  probes: EndpointProbeResult[];
  dimensions: DiagnosticDimension[];
  categorizedErrors?: CategorizedDiagnosticItem[];
  viaBackend?: boolean;
  detectedErrors: string[];
  securityNotes: string[];
  overallStatus: ConnectionStatus;
  summaryMessage: string;
}

export type CommunicationMode = 'backend_secure' | 'direct_browser';

export interface IptvConnection {
  id: string;
  name: string;
  type: ProviderType;
  preset: ProviderPreset;
  communicationMode?: CommunicationMode;
  serverUrl: string;
  username?: string;
  password?: string;
  token?: string;
  rememberSecretsInBrowser?: boolean;
  catalogId?: string;
  m3uUrl?: string;
  m3uRawContent?: string;
  customEndpoints?: CustomEndpointsConfig;
  status: ConnectionStatus;
  statusMessage?: string;
  lastTestedAt?: number;
  lastDiscoveryReport?: DiscoveryReport;
  capabilities: ProviderCapabilities;
  accountInfo?: ProviderAccountInfo;
  createdAt: number;
  updatedAt: number;
}

export interface CatalogCategory {
  id: string;
  name: string;
  type: MediaType;
  count?: number;
}

export interface CatalogItem {
  id: string;
  connectionId: string;
  type: MediaType;
  name: string;
  categoryId: string;
  categoryName?: string;
  logo?: string;
  backdrop?: string;
  containerExtension?: string;
  rating?: number;
  year?: string;
  added?: number;
  streamUrl?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  duration?: string;
  channelNumber?: number;
}

export interface EpisodeItem {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  plot?: string;
  duration?: string;
  thumbnail?: string;
  containerExtension?: string;
  streamUrl?: string;
  added?: number;
  rating?: number;
}

export interface SeasonGroup {
  seasonNumber: number;
  name: string;
  episodes: EpisodeItem[];
  cover?: string;
  overview?: string;
}

export interface MovieDetails {
  item: CatalogItem;
  plot?: string;
  director?: string;
  cast?: string;
  genre?: string;
  duration?: string;
  releaseDate?: string;
  backdrop?: string;
  trailer?: string;
  tmdbId?: string;
  containerExtension?: string;
  missingDetailsNotice?: string;
}

export interface SeriesDetails {
  item: CatalogItem;
  plot?: string;
  director?: string;
  cast?: string;
  genre?: string;
  releaseDate?: string;
  backdrop?: string;
  seasons: SeasonGroup[];
  pendingIntegrationNotice?: {
    title: string;
    description: string;
    missingEndpoints: string[];
  };
}

export interface SubtitleTrackOption {
  id: string;
  label: string;
  language?: string;
  src?: string;
}

export interface AudioTrackOption {
  id: string;
  label: string;
  language?: string;
}

export interface PlaybackAlternative {
  label: string;
  url: string;
  format: string;
}

export interface PlaybackSourceResolution {
  status: 'ready' | 'pending_endpoint' | 'incompatible_format' | 'error';
  url?: string;
  format?: string;
  engine?: 'hls' | 'html5' | 'unsupported';
  browserCompatible: boolean;
  message?: string;
  missingEndpointDoc?: string;
  subtitles?: SubtitleTrackOption[];
  alternatives?: PlaybackAlternative[];
}

export interface ConnectionTestResult {
  success: boolean;
  status: ConnectionStatus;
  message: string;
  details?: string;
  corsDetected?: boolean;
  accountInfo?: ProviderAccountInfo;
  capabilities?: Partial<ProviderCapabilities>;
  sampleItemsCount?: number;
  pendingEndpoints?: string[];
}

export interface PlaybackProgress {
  itemId: string;
  connectionId: string;
  type: MediaType;
  name: string;
  logo?: string;
  year?: string;
  rating?: number;
  containerExtension?: string;
  episodeId?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
}

export interface WatchHistoryEntry {
  key: string;
  itemId: string;
  connectionId: string;
  type: MediaType;
  name: string;
  logo?: string;
  year?: string;
  rating?: number;
  containerExtension?: string;
  episodeId?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  watchedAt: number;
}

export interface FavoriteItem {
  key: string;
  item: CatalogItem;
  addedAt: number;
}

export interface UserPreferences {
  autoPlayNextEpisode: boolean;
  preferHls: boolean;
  defaultVolume: number;
  catalogPageSize: number;
  enableLocalCache: boolean;
  showFormatBadgesInDetail: boolean;
}

export interface CachedCatalog {
  connectionId: string;
  updatedAt: number;
  movieCategories: CatalogCategory[];
  movies: CatalogItem[];
  seriesCategories: CatalogCategory[];
  series: CatalogItem[];
  liveCategories: CatalogCategory[];
  liveStreams: CatalogItem[];
}

export interface AppBackupData {
  app: 'NEXUS IPTV';
  schemaVersion: number;
  exportedAt: string;
  includesSecrets: boolean;
  connections: IptvConnection[];
  activeConnectionId: string | null;
  favorites: FavoriteItem[];
  history: WatchHistoryEntry[];
  progress: Record<string, PlaybackProgress>;
  preferences: UserPreferences;
}

export interface PlayerSession {
  item: CatalogItem;
  episode?: EpisodeItem;
  seriesSeasons?: SeasonGroup[];
  source: PlaybackSourceResolution;
  resumeFromSeconds?: number;
}
