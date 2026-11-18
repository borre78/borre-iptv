import { Menu, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MediaDetailModal } from './components/MediaDetailModal';
import { MediaPoster } from './components/MediaPoster';
import { Sidebar } from './components/Sidebar';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { CatalogGridView } from './pages/CatalogGridView';
import { ConnectionsView } from './pages/ConnectionsView';
import { DiagnosticsView } from './pages/DiagnosticsView';
import { HomeView } from './pages/HomeView';
import { LiveTvView } from './pages/LiveTvView';
import { HistoryView, MyListView } from './pages/MyListAndHistoryView';
import { SettingsView } from './pages/SettingsView';
import {
  customApiAdapter,
  loadProviderCatalog,
  resolveItemPlaybackSource,
} from './services/adapters';
import {
  loadActiveConnectionId,
  loadConnections,
  loadFavorites,
  loadHistory,
  loadPreferences,
  loadProgressMap,
  makeItemKey,
  makeProgressKey,
  recordHistoryEntry,
  saveActiveConnectionId,
  saveConnections,
  saveHistory,
  savePreferences,
  saveProgressMap,
  toggleFavoriteItem,
} from './services/storageService';
import {
  CatalogCategory,
  CatalogItem,
  DiscoveryReport,
  EpisodeItem,
  FavoriteItem,
  IptvConnection,
  NavSection,
  PlaybackProgress,
  PlayerSession,
  SeasonGroup,
  UserPreferences,
  WatchHistoryEntry,
} from './types/iptv';

const SECTION_TITLES: Record<NavSection, string> = {
  home: 'Inicio',
  live: 'TV en vivo',
  movies: 'Películas',
  series: 'Series',
  mylist: 'Mi lista',
  history: 'Historial',
  connections: 'Mis conexiones',
  diagnostics: 'Autodetección y diagnóstico',
  settings: 'Configuración',
};

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Estado persistido en LocalStorage
  const [connections, setConnections] = useState<IptvConnection[]>(() =>
    loadConnections()
  );
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(() => {
    const savedId = loadActiveConnectionId();
    const list = loadConnections();
    if (savedId && list.some((c) => c.id === savedId)) return savedId;
    return list[0]?.id || null;
  });
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites());
  const [history, setHistory] = useState<WatchHistoryEntry[]>(() => loadHistory());
  const [progressMap, setProgressMap] = useState<Record<string, PlaybackProgress>>(
    () => loadProgressMap()
  );
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    loadPreferences()
  );

  // Catálogo en memoria del proveedor activo
  const [movies, setMovies] = useState<CatalogItem[]>([]);
  const [movieCategories, setMovieCategories] = useState<CatalogCategory[]>([]);
  const [series, setSeries] = useState<CatalogItem[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<CatalogCategory[]>([]);
  const [liveStreams, setLiveStreams] = useState<CatalogItem[]>([]);
  const [liveCategories, setLiveCategories] = useState<CatalogCategory[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [catalogErrors, setCatalogErrors] = useState<string[]>([]);

  // Búsqueda global rápida
  const [globalSearch, setGlobalSearch] = useState('');
  const [diagnosticTargetId, setDiagnosticTargetId] = useState<string | null>(null);

  // Modales activos
  const [detailItem, setDetailItem] = useState<CatalogItem | null>(null);
  const [playerSession, setPlayerSession] = useState<PlayerSession | null>(null);
  const [isResolvingPlayback, setIsResolvingPlayback] = useState(false);

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) || null,
    [connections, activeConnectionId]
  );

  const fetchCatalogForConnection = useCallback(
    async (conn: IptvConnection | null, forceRefresh = false) => {
      if (!conn) {
        setMovies([]);
        setMovieCategories([]);
        setSeries([]);
        setSeriesCategories([]);
        setLiveStreams([]);
        setLiveCategories([]);
        setCatalogErrors([]);
        return;
      }

      setIsCatalogLoading(true);
      setCatalogErrors([]);
      try {
        const bundle = await loadProviderCatalog(conn, {
          useCache: preferences.enableLocalCache,
          forceRefresh,
        });
        setMovies(bundle.movies);
        setMovieCategories(bundle.movieCategories);
        setSeries(bundle.series);
        setSeriesCategories(bundle.seriesCategories);
        setLiveStreams(bundle.liveStreams);
        setLiveCategories(bundle.liveCategories);
        setCatalogErrors(bundle.errors);
      } catch (err) {
        setCatalogErrors([
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el catálogo del proveedor.',
        ]);
      } finally {
        setIsCatalogLoading(false);
      }
    },
    [preferences.enableLocalCache]
  );

  useEffect(() => {
    fetchCatalogForConnection(activeConnection, false);
  }, [activeConnection, fetchCatalogForConnection]);

  // Gestión de conexiones
  const handleSaveConnection = (conn: IptvConnection) => {
    setConnections((prev) => {
      const exists = prev.some((c) => c.id === conn.id);
      const next = exists
        ? prev.map((c) => (c.id === conn.id ? conn : c))
        : [...prev, conn];
      saveConnections(next);
      return next;
    });

    if (!activeConnectionId) {
      setActiveConnectionId(conn.id);
      saveActiveConnectionId(conn.id);
    } else if (activeConnectionId === conn.id) {
      // Forzar recarga si se editó la conexión activa
      fetchCatalogForConnection(conn, true);
    }
  };

  const handleDeleteConnection = (id: string) => {
    customApiAdapter.logout(id);
    setConnections((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveConnections(next);
      if (activeConnectionId === id) {
        const nextActive = next[0]?.id || null;
        setActiveConnectionId(nextActive);
        saveActiveConnectionId(nextActive);
      }
      return next;
    });
  };

  const handleSelectConnection = (id: string) => {
    setActiveConnectionId(id);
    saveActiveConnectionId(id);
  };

  const handleUpdateConnectionWithReport = (
    connectionId: string,
    report: DiscoveryReport
  ) => {
    setConnections((prev) => {
      const next = prev.map((c) => {
        if (c.id !== connectionId) return c;
        return {
          ...c,
          status: report.overallStatus,
          statusMessage: report.summaryMessage,
          lastTestedAt: report.testedAt,
          lastDiscoveryReport: report,
          accountInfo: report.accountInfo || c.accountInfo,
          capabilities: {
            ...c.capabilities,
            ...report.suggestedCapabilities,
          },
          customEndpoints:
            c.type === 'custom_api'
              ? {
                  ...report.suggestedEndpoints,
                  ...(c.customEndpoints || {}),
                }
              : c.customEndpoints,
          updatedAt: Date.now(),
        };
      });
      saveConnections(next);
      return next;
    });
  };

  // Favoritos
  const handleToggleFavorite = (item: CatalogItem) => {
    setFavorites((prev) => toggleFavoriteItem(prev, item));
  };

  // Reproducción directa (Película o TV en vivo)
  const handlePlayItem = async (item: CatalogItem, resumeSeconds?: number) => {
    const conn =
      connections.find((c) => c.id === item.connectionId) || activeConnection;
    if (!conn) return;

    setIsResolvingPlayback(true);
    try {
      const source = await resolveItemPlaybackSource(conn, item);
      setHistory((prev) =>
        recordHistoryEntry(prev, {
          itemId: item.id,
          connectionId: conn.id,
          type: item.type,
          name: item.name,
          logo: item.logo,
          year: item.year,
          rating: item.rating,
          containerExtension: item.containerExtension,
        })
      );
      setDetailItem(null);
      setPlayerSession({
        item,
        source,
        resumeFromSeconds: resumeSeconds,
      });
    } finally {
      setIsResolvingPlayback(false);
    }
  };

  // Reproducción de episodio de serie
  const handlePlayEpisode = async (
    item: CatalogItem,
    episode: EpisodeItem,
    seasons: SeasonGroup[],
    resumeSeconds?: number
  ) => {
    const conn =
      connections.find((c) => c.id === item.connectionId) || activeConnection;
    if (!conn) return;

    setIsResolvingPlayback(true);
    try {
      const source = await resolveItemPlaybackSource(conn, item, episode);
      setHistory((prev) =>
        recordHistoryEntry(prev, {
          itemId: item.id,
          connectionId: conn.id,
          type: 'series',
          name: item.name,
          logo: item.logo,
          year: item.year,
          rating: item.rating,
          containerExtension: episode.containerExtension || item.containerExtension,
          episodeId: episode.id,
          episodeTitle: episode.title,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
        })
      );
      setDetailItem(null);
      setPlayerSession({
        item,
        episode,
        seriesSeasons: seasons,
        source,
        resumeFromSeconds: resumeSeconds,
      });
    } finally {
      setIsResolvingPlayback(false);
    }
  };

  // Guardar progreso de reproducción
  const handleProgressUpdate = useCallback(
    (positionSeconds: number, durationSeconds: number) => {
      if (!playerSession) return;
      const { item, episode } = playerSession;
      const key = makeProgressKey(
        item.connectionId,
        item.type,
        item.id,
        episode?.id
      );

      setProgressMap((prev) => {
        const next: Record<string, PlaybackProgress> = {
          ...prev,
          [key]: {
            itemId: item.id,
            connectionId: item.connectionId,
            type: item.type,
            name: item.name,
            logo: item.logo,
            year: item.year,
            rating: item.rating,
            containerExtension:
              episode?.containerExtension || item.containerExtension,
            episodeId: episode?.id,
            episodeTitle: episode?.title,
            seasonNumber: episode?.seasonNumber,
            episodeNumber: episode?.episodeNumber,
            positionSeconds,
            durationSeconds,
            updatedAt: Date.now(),
          },
        };
        saveProgressMap(next);
        return next;
      });
    },
    [playerSession]
  );

  // Abrir elemento desde Historial
  const handleSelectHistoryEntry = (entry: WatchHistoryEntry) => {
    const pool =
      entry.type === 'live'
        ? liveStreams
        : entry.type === 'series'
        ? series
        : movies;
    const found = pool.find(
      (i) => i.id === entry.itemId && i.connectionId === entry.connectionId
    );
    const targetItem: CatalogItem = found || {
      id: entry.itemId,
      connectionId: entry.connectionId,
      type: entry.type,
      name: entry.name,
      categoryId: 'general',
      logo: entry.logo,
      year: entry.year,
      rating: entry.rating,
      containerExtension: entry.containerExtension,
    };

    if (entry.type === 'live') {
      handlePlayItem(targetItem);
    } else {
      setDetailItem(targetItem);
    }
  };

  // Resultados de búsqueda rápida global
  const globalSearchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return [...movies, ...series, ...liveStreams]
      .filter((i) => i.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [globalSearch, liveStreams, movies, series]);

  const handleBackupImported = () => {
    const reloadedConns = loadConnections();
    const reloadedActive = loadActiveConnectionId();
    setConnections(reloadedConns);
    setActiveConnectionId(
      reloadedActive && reloadedConns.some((c) => c.id === reloadedActive)
        ? reloadedActive
        : reloadedConns[0]?.id || null
    );
    setFavorites(loadFavorites());
    setHistory(loadHistory());
    setProgressMap(loadProgressMap());
    setPreferences(loadPreferences());
  };

  const detailConnection = detailItem
    ? connections.find((c) => c.id === detailItem.connectionId) || activeConnection
    : null;

  return (
    <div className="flex min-h-screen bg-[#09090D] text-[#F4F4F7]">
      {/* Menú lateral */}
      <Sidebar
        activeSection={activeSection}
        onNavigate={(sec) => {
          setActiveSection(sec);
          setGlobalSearch('');
        }}
        connections={connections}
        activeConnection={activeConnection}
        onSelectConnection={handleSelectConnection}
        onRefreshCatalog={() => fetchCatalogForConnection(activeConnection, true)}
        isCatalogLoading={isCatalogLoading}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Área principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabecera superior limpia (3 zonas) */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-white/[0.06] bg-[#09090D]/90 px-4 py-3.5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menú lateral"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#13141C] text-zinc-200 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="font-display text-sm font-semibold text-zinc-200 whitespace-nowrap">
              {SECTION_TITLES[activeSection]}
            </span>
          </div>

          {/* Buscador rápido global */}
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Buscar en películas, series o TV..."
              aria-label="Búsqueda rápida global"
              className="w-full rounded-lg border border-white/10 bg-[#11131B] py-2 pl-9 pr-8 text-xs text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none sm:text-sm"
            />
            {globalSearch && (
              <button
                type="button"
                onClick={() => setGlobalSearch('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            {/* Desplegable de resultados rápidos */}
            {globalSearchResults.length > 0 && (
              <div className="absolute inset-x-0 top-11 z-40 max-h-96 overflow-y-auto rounded-xl border border-white/15 bg-[#12141D] p-1.5 shadow-2xl">
                {globalSearchResults.map((res) => (
                  <button
                    key={`gsearch-${res.type}-${res.id}`}
                    type="button"
                    onClick={() => {
                      setGlobalSearch('');
                      if (res.type === 'live') {
                        handlePlayItem(res);
                      } else {
                        setDetailItem(res);
                      }
                    }}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <div className="h-11 w-8 shrink-0 overflow-hidden rounded bg-[#09090D]">
                      <MediaPoster src={res.logo} alt={res.name} type={res.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">
                        {res.name}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {res.type === 'live'
                          ? 'TV en vivo'
                          : res.type === 'series'
                          ? 'Serie'
                          : 'Película'}
                        {res.year ? ` · ${res.year}` : ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => setActiveSection('connections')}
              className="rounded-lg border border-white/10 bg-[#13141C] px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-violet-500/40 hover:text-white whitespace-nowrap"
            >
              {activeConnection ? activeConnection.name : 'Conectar proveedor'}
            </button>
          </div>
        </header>

        {/* Contenido principal */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {activeSection === 'home' && (
            <HomeView
              activeConnection={activeConnection}
              movies={movies}
              series={series}
              liveStreams={liveStreams}
              favorites={favorites}
              progressMap={progressMap}
              isLoading={isCatalogLoading}
              catalogErrors={catalogErrors}
              onRetryLoad={() => fetchCatalogForConnection(activeConnection, true)}
              onNavigate={setActiveSection}
              onSelectItem={(item) => {
                if (item.type === 'live') {
                  handlePlayItem(item);
                } else {
                  setDetailItem(item);
                }
              }}
              onQuickPlay={handlePlayItem}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {activeSection === 'movies' && (
            <CatalogGridView
              mediaType="movie"
              activeConnection={activeConnection}
              items={movies}
              categories={movieCategories}
              favorites={favorites}
              pageSize={preferences.catalogPageSize}
              isLoading={isCatalogLoading}
              onRetryLoad={() => fetchCatalogForConnection(activeConnection, true)}
              onNavigate={setActiveSection}
              onSelectItem={setDetailItem}
              onQuickPlay={(it) => handlePlayItem(it)}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {activeSection === 'series' && (
            <CatalogGridView
              mediaType="series"
              activeConnection={activeConnection}
              items={series}
              categories={seriesCategories}
              favorites={favorites}
              pageSize={preferences.catalogPageSize}
              isLoading={isCatalogLoading}
              onRetryLoad={() => fetchCatalogForConnection(activeConnection, true)}
              onNavigate={setActiveSection}
              onSelectItem={setDetailItem}
              onQuickPlay={setDetailItem}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {activeSection === 'live' && (
            <LiveTvView
              activeConnection={activeConnection}
              channels={liveStreams}
              categories={liveCategories}
              favorites={favorites}
              pageSize={preferences.catalogPageSize}
              isLoading={isCatalogLoading}
              onRetryLoad={() => fetchCatalogForConnection(activeConnection, true)}
              onNavigate={setActiveSection}
              onPlayChannel={(ch) => handlePlayItem(ch)}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {activeSection === 'mylist' && (
            <MyListView
              favorites={favorites}
              onSelectItem={(item) => {
                if (item.type === 'live') {
                  handlePlayItem(item);
                } else {
                  setDetailItem(item);
                }
              }}
              onQuickPlay={(item) => handlePlayItem(item)}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {activeSection === 'history' && (
            <HistoryView
              history={history}
              progressMap={progressMap}
              onSelectHistoryItem={handleSelectHistoryEntry}
              onClearHistory={() => {
                saveHistory([]);
                setHistory([]);
              }}
            />
          )}

          {activeSection === 'connections' && (
            <ConnectionsView
              connections={connections}
              activeConnectionId={activeConnectionId}
              onSaveConnection={handleSaveConnection}
              onDeleteConnection={handleDeleteConnection}
              onActivateConnection={(id) => {
                handleSelectConnection(id);
                setActiveSection('home');
              }}
              onOpenDiagnostics={(id) => {
                setDiagnosticTargetId(id);
                setActiveSection('diagnostics');
              }}
              onRefreshActiveCatalog={(connId) => {
                const target = connections.find((c) => c.id === connId);
                if (target && connId === activeConnectionId) {
                  fetchCatalogForConnection(target, true);
                }
              }}
            />
          )}

          {activeSection === 'diagnostics' && (
            <DiagnosticsView
              connections={connections}
              selectedConnectionId={diagnosticTargetId || activeConnectionId}
              onSelectConnectionId={(id) => setDiagnosticTargetId(id)}
              onUpdateConnectionWithReport={handleUpdateConnectionWithReport}
              onNavigateToConnections={() => setActiveSection('connections')}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              preferences={preferences}
              onUpdatePreferences={(next) => {
                setPreferences(next);
                savePreferences(next);
              }}
              onBackupImported={handleBackupImported}
            />
          )}
        </main>
      </div>

      {/* Indicador de resolución de stream */}
      {isResolvingPlayback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="rounded-xl border border-white/10 bg-[#11131B] px-6 py-4 text-sm text-white">
            Preparando fuente de reproducción...
          </div>
        </div>
      )}

      {/* Modal de detalles (Películas / Series) */}
      {detailItem && detailConnection && (
        <MediaDetailModal
          item={detailItem}
          connection={detailConnection}
          isFavorite={favorites.some(
            (f) =>
              f.key ===
              makeItemKey(detailItem.connectionId, detailItem.type, detailItem.id)
          )}
          progressMap={progressMap}
          showFormatNotice={preferences.showFormatBadgesInDetail}
          onClose={() => setDetailItem(null)}
          onToggleFavorite={handleToggleFavorite}
          onPlayMovie={handlePlayItem}
          onPlayEpisode={handlePlayEpisode}
          onOpenConnections={() => {
            setDetailItem(null);
            setActiveSection('connections');
          }}
        />
      )}

      {/* Reproductor moderno HLS.js + HTML5 */}
      {playerSession && (
        <VideoPlayerModal
          session={playerSession}
          defaultVolume={preferences.defaultVolume}
          autoPlayNextEpisode={preferences.autoPlayNextEpisode}
          onClose={() => setPlayerSession(null)}
          onProgressUpdate={handleProgressUpdate}
          onPlayNextEpisode={(nextEp) => {
            if (playerSession.seriesSeasons) {
              handlePlayEpisode(
                playerSession.item,
                nextEp,
                playerSession.seriesSeasons
              );
            }
          }}
          onOpenConnections={() => {
            setPlayerSession(null);
            setActiveSection('connections');
          }}
        />
      )}
    </div>
  );
}
