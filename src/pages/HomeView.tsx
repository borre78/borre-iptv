import {
  AlertCircle,
  Bookmark,
  Check,
  Film,
  Info,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  Star,
} from 'lucide-react';
import { useMemo } from 'react';
import { CarouselRow } from '../components/CarouselRow';
import { MediaCard } from '../components/MediaCard';
import { MediaPoster } from '../components/MediaPoster';
import { makeItemKey, makeProgressKey } from '../services/storageService';
import {
  CatalogItem,
  FavoriteItem,
  IptvConnection,
  NavSection,
  PlaybackProgress,
} from '../types/iptv';

const CINEMA_HERO_BACKDROP =
  '/src/assets/images/nexus_cinema_backdrop_1795018604192.jpg';

interface HomeViewProps {
  activeConnection: IptvConnection | null;
  movies: CatalogItem[];
  series: CatalogItem[];
  liveStreams: CatalogItem[];
  favorites: FavoriteItem[];
  progressMap: Record<string, PlaybackProgress>;
  isLoading: boolean;
  catalogErrors: string[];
  onRetryLoad: () => void;
  onNavigate: (section: NavSection) => void;
  onSelectItem: (item: CatalogItem) => void;
  onQuickPlay: (item: CatalogItem, resumeSeconds?: number) => void;
  onToggleFavorite: (item: CatalogItem) => void;
}

export function HomeView({
  activeConnection,
  movies,
  series,
  liveStreams,
  favorites,
  progressMap,
  isLoading,
  catalogErrors,
  onRetryLoad,
  onNavigate,
  onSelectItem,
  onQuickPlay,
  onToggleFavorite,
}: HomeViewProps) {
  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => f.key)),
    [favorites]
  );

  const isFav = (item: CatalogItem) =>
    favoriteKeys.has(makeItemKey(item.connectionId, item.type, item.id));

  // Continuar viendo desde LocalStorage filtrado por conexión activa (o todas si se desea)
  const continueWatching = useMemo(() => {
    const allItemsMap = new Map<string, CatalogItem>();
    [...movies, ...series].forEach((it) => {
      allItemsMap.set(`${it.connectionId}::${it.type}::${it.id}`, it);
    });

    return Object.values(progressMap)
      .filter(
        (p) =>
          p.positionSeconds > 5 &&
          (!activeConnection || p.connectionId === activeConnection.id)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 15)
      .map((p) => {
        const matched = allItemsMap.get(`${p.connectionId}::${p.type}::${p.itemId}`);
        const fallbackItem: CatalogItem = matched || {
          id: p.itemId,
          connectionId: p.connectionId,
          type: p.type,
          name: p.name,
          categoryId: 'general',
          logo: p.logo,
          year: p.year,
          rating: p.rating,
          containerExtension: p.containerExtension,
        };
        return { item: fallbackItem, progress: p };
      });
  }, [activeConnection, movies, progressMap, series]);

  // Últimas películas ordenadas por fecha de agregado o año
  const latestMovies = useMemo(() => {
    return [...movies]
      .sort((a, b) => (b.added || 0) - (a.added || 0))
      .slice(0, 18);
  }, [movies]);

  // Últimas series
  const latestSeries = useMemo(() => {
    return [...series]
      .sort((a, b) => (b.added || 0) - (a.added || 0))
      .slice(0, 18);
  }, [series]);

  // Top 10 combinado por calificación
  const top10Items = useMemo(() => {
    const combined = [...movies, ...series];
    return combined
      .filter((i) => (i.rating || 0) > 0)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 10);
  }, [movies, series]);

  // Tendencias (mezcla reciente + mejor puntuada)
  const trendingItems = useMemo(() => {
    const combined = [...movies, ...series];
    return combined
      .sort((a, b) => {
        const scoreA = (a.rating || 0) * 100000 + (a.added || 0) / 100000;
        const scoreB = (b.rating || 0) * 100000 + (b.added || 0) / 100000;
        return scoreB - scoreA;
      })
      .slice(0, 18);
  }, [movies, series]);

  // Recomendados
  const recommendedMovies = useMemo(() => {
    return [...movies]
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 18);
  }, [movies]);

  const recommendedSeries = useMemo(() => {
    return [...series]
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 18);
  }, [series]);

  // Elemento destacado para el banner principal
  const heroItem = useMemo(() => {
    return (
      top10Items[0] ||
      latestMovies[0] ||
      latestSeries[0] ||
      liveStreams[0] ||
      null
    );
  }, [latestMovies, latestSeries, liveStreams, top10Items]);

  // Estado inicial sin proveedor conectado
  if (!activeConnection) {
    return (
      <div className="space-y-8">
        <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11131B]">
          <div className="relative min-h-[420px] w-full">
            <img
              src={CINEMA_HERO_BACKDROP}
              alt="Sala cinematográfica oscura de NEXUS IPTV"
              className="absolute inset-0 h-full w-full object-cover opacity-75"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#09090D] via-[#09090D]/85 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090D] via-transparent to-black/30" />

            <div className="relative z-10 flex min-h-[420px] max-w-2xl flex-col justify-center p-7 sm:p-12">
              <h1 className="font-display text-3xl font-bold tracking-tight text-white text-balance sm:text-5xl">
                Tu centro de streaming IPTV, sin límites artificiales
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-zinc-300 sm:text-base">
                Conecta tus proveedores mediante Xtream Codes, listas M3U autorizadas o
                APIs personalizadas como Netsky y Kaelus. Todo se guarda localmente en este
                navegador, sin servidores intermedios ni credenciales inventadas.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('connections')}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-95"
                >
                  <Plug className="h-4 w-4" aria-hidden="true" />
                  Configurar conexión IPTV
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10"
                >
                  Importar respaldo JSON
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-white/[0.08] bg-[#11131B] p-6">
            <h2 className="font-display text-base font-semibold text-white">
              Xtream Codes API
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Autenticación estándar, categorías, películas, series con temporadas y
              episodios, y canales en vivo respetando los formatos permitidos por el
              servidor.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#11131B] p-6">
            <h2 className="font-display text-base font-semibold text-white">
              Listas M3U y archivos locales
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Carga URLs M3U autorizadas o importa archivos .m3u / .m3u8 locales con
              agrupación automática por categorías y reproducción HLS.js.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#11131B] p-6">
            <h2 className="font-display text-base font-semibold text-white">
              APIs personalizadas (Netsky, Kaelus)
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Adaptadores independientes por protocolo con identificador de catálogo
              configurable y documentación transparente de endpoints pendientes.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Banner de error de catálogo si aplica */}
      {catalogErrors.length > 0 && (
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-rose-400"
              aria-hidden="true"
            />
            <div className="space-y-1 text-xs text-rose-200">
              <p className="text-sm font-semibold">
                Avisos al consultar "{activeConnection.name}"
              </p>
              {catalogErrors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onRetryLoad}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/20 px-3.5 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/30"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reintentar
          </button>
        </div>
      )}

      {/* Estado de carga inicial del catálogo */}
      {isLoading && movies.length === 0 && series.length === 0 && liveStreams.length === 0 ? (
        <div className="flex min-h-[340px] flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-[#11131B] p-8 text-center">
          <Loader2 className="h-9 w-9 animate-spin text-violet-400" aria-hidden="true" />
          <p className="mt-4 font-display text-lg font-semibold text-white">
            Cargando catálogo de {activeConnection.name}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Consultando categorías, películas, series y canales disponibles...
          </p>
        </div>
      ) : heroItem ? (
        /* Banner principal con contenido real del proveedor */
        <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11131B]">
          <div className="relative min-h-[360px] w-full sm:min-h-[420px]">
            <img
              src={heroItem.backdrop || heroItem.logo || CINEMA_HERO_BACKDROP}
              alt={heroItem.name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = CINEMA_HERO_BACKDROP;
              }}
              className="absolute inset-0 h-full w-full object-cover object-center opacity-50 blur-[1px] scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#09090D] via-[#09090D]/85 to-[#09090D]/30" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090D] via-transparent to-black/30" />

            <div className="relative z-10 grid min-h-[360px] items-end gap-6 p-6 sm:min-h-[420px] sm:grid-cols-[1fr_200px] sm:items-center sm:p-10">
              <div className="max-w-2xl space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-300 tabular-nums">
                  <span className="text-violet-400">Destacado en {activeConnection.name}</span>
                  {heroItem.year && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{heroItem.year}</span>
                    </>
                  )}
                  {heroItem.rating && heroItem.rating > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                        {heroItem.rating.toFixed(1)}
                      </span>
                    </>
                  )}
                  {heroItem.containerExtension && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono uppercase">
                        {heroItem.containerExtension}
                      </span>
                    </>
                  )}
                </div>

                <h1 className="font-display text-3xl font-bold leading-tight text-white text-balance sm:text-4xl lg:text-5xl">
                  {heroItem.name}
                </h1>

                {heroItem.plot && (
                  <p className="line-clamp-3 text-sm leading-relaxed text-zinc-300">
                    {heroItem.plot}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (heroItem.type === 'series') {
                        onSelectItem(heroItem);
                      } else {
                        const pk = makeProgressKey(
                          heroItem.connectionId,
                          heroItem.type,
                          heroItem.id
                        );
                        onQuickPlay(heroItem, progressMap[pk]?.positionSeconds);
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-95"
                  >
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    {heroItem.type === 'series' ? 'Ver episodios' : 'Reproducir'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectItem(heroItem)}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.08] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
                  >
                    <Info className="h-4 w-4" aria-hidden="true" />
                    Detalles
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleFavorite(heroItem)}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/40 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-black/70"
                  >
                    {isFav(heroItem) ? (
                      <Check className="h-4 w-4 text-blue-400" aria-hidden="true" />
                    ) : (
                      <Bookmark className="h-4 w-4" aria-hidden="true" />
                    )}
                    {isFav(heroItem) ? 'En Mi lista' : 'Mi lista'}
                  </button>
                </div>
              </div>

              {/* Póster lateral en desktop */}
              <div className="hidden aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/15 bg-[#09090D] shadow-2xl sm:block">
                <MediaPoster
                  src={heroItem.logo}
                  alt={heroItem.name}
                  type={heroItem.type}
                />
              </div>
            </div>
          </div>
        </section>
      ) : (
        /* Proveedor conectado pero sin contenido aún */
        <section className="rounded-2xl border border-white/[0.08] bg-[#11131B] p-8 text-center">
          <Film className="mx-auto h-10 w-10 text-zinc-500" aria-hidden="true" />
          <h2 className="mt-4 font-display text-xl font-semibold text-white">
            No se encontraron títulos en "{activeConnection.name}"
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-400">
            Verifica los parámetros del proveedor, el identificador de catálogo o los
            permisos CORS en Mis conexiones.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={onRetryLoad}
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500"
            >
              Volver a cargar
            </button>
            <button
              type="button"
              onClick={() => onNavigate('connections')}
              className="rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-white/5"
            >
              Revisar conexión
            </button>
          </div>
        </section>
      )}

      {/* Carrusel: Continuar viendo */}
      {continueWatching.length > 0 && (
        <CarouselRow
          title="Continuar viendo"
          subtitle="Retoma desde el punto exacto guardado en este navegador"
        >
          {continueWatching.map(({ item, progress }) => (
            <MediaCard
              key={`${item.id}-${progress.episodeId || 'main'}`}
              item={item}
              progress={progress}
              variant="continue"
              isFavorite={isFav(item)}
              onSelect={onSelectItem}
              onQuickPlay={(it) => onQuickPlay(it, progress.positionSeconds)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </CarouselRow>
      )}

      {/* Carrusel: Top 10 */}
      {top10Items.length > 0 && (
        <CarouselRow
          title="Top 10"
          subtitle="Los títulos mejor valorados de tu proveedor"
        >
          {top10Items.map((item, idx) => (
            <MediaCard
              key={`top-${item.type}-${item.id}`}
              item={item}
              rankIndex={idx + 1}
              isFavorite={isFav(item)}
              onSelect={onSelectItem}
              onQuickPlay={(it) =>
                it.type === 'series' ? onSelectItem(it) : onQuickPlay(it)
              }
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </CarouselRow>
      )}

      {/* Carrusel: Tendencias */}
      {trendingItems.length > 0 && (
        <CarouselRow title="Tendencias">
          {trendingItems.map((item) => (
            <MediaCard
              key={`trend-${item.type}-${item.id}`}
              item={item}
              isFavorite={isFav(item)}
              onSelect={onSelectItem}
              onQuickPlay={(it) =>
                it.type === 'series' ? onSelectItem(it) : onQuickPlay(it)
              }
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </CarouselRow>
      )}

      {/* Carrusel: Últimas películas */}
      {latestMovies.length > 0 && (
        <CarouselRow
          title="Últimas películas"
          actionLabel="Ver catálogo completo"
          onAction={() => onNavigate('movies')}
        >
          {latestMovies.map((item) => (
            <MediaCard
              key={`lmov-${item.id}`}
              item={item}
              isFavorite={isFav(item)}
              onSelect={onSelectItem}
              onQuickPlay={(it) => onQuickPlay(it)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </CarouselRow>
      )}

      {/* Carrusel: Últimas series */}
      {latestSeries.length > 0 && (
        <CarouselRow
          title="Últimas series"
          actionLabel="Ver todas las series"
          onAction={() => onNavigate('series')}
        >
          {latestSeries.map((item) => (
            <MediaCard
              key={`lser-${item.id}`}
              item={item}
              isFavorite={isFav(item)}
              onSelect={onSelectItem}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </CarouselRow>
      )}

      {/* Carrusel: Películas recomendadas */}
      {recommendedMovies.length > 0 && (
        <CarouselRow
          title="Películas recomendadas"
          actionLabel="Explorar"
          onAction={() => onNavigate('movies')}
        >
          {recommendedMovies.map((item) => (
            <MediaCard
              key={`rmov-${item.id}`}
              item={item}
              isFavorite={isFav(item)}
              onSelect={onSelectItem}
              onQuickPlay={(it) => onQuickPlay(it)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </CarouselRow>
      )}

      {/* Carrusel: Series recomendadas */}
      {recommendedSeries.length > 0 && (
        <CarouselRow
          title="Series recomendadas"
          actionLabel="Explorar"
          onAction={() => onNavigate('series')}
        >
          {recommendedSeries.map((item) => (
            <MediaCard
              key={`rser-${item.id}`}
              item={item}
              isFavorite={isFav(item)}
              onSelect={onSelectItem}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </CarouselRow>
      )}
    </div>
  );
}
