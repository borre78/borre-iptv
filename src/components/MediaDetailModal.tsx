import {
  AlertCircle,
  Bookmark,
  Check,
  Loader2,
  Play,
  Settings2,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  fetchMovieDetails,
  fetchSeriesDetails,
} from '../services/adapters';
import { makeProgressKey } from '../services/storageService';
import {
  CatalogItem,
  EpisodeItem,
  IptvConnection,
  MovieDetails,
  PlaybackProgress,
  SeasonGroup,
  SeriesDetails,
} from '../types/iptv';
import { analyzeMediaFormat } from '../utils/mediaFormats';
import { MediaPoster } from './MediaPoster';

interface MediaDetailModalProps {
  item: CatalogItem;
  connection: IptvConnection;
  isFavorite: boolean;
  progressMap: Record<string, PlaybackProgress>;
  showFormatNotice: boolean;
  onClose: () => void;
  onToggleFavorite: (item: CatalogItem) => void;
  onPlayMovie: (item: CatalogItem, resumeSeconds?: number) => void;
  onPlayEpisode: (
    item: CatalogItem,
    episode: EpisodeItem,
    seasons: SeasonGroup[],
    resumeSeconds?: number
  ) => void;
  onOpenConnections: () => void;
}

export function MediaDetailModal({
  item,
  connection,
  isFavorite,
  progressMap,
  showFormatNotice,
  onClose,
  onToggleFavorite,
  onPlayMovie,
  onPlayEpisode,
  onOpenConnections,
}: MediaDetailModalProps) {
  const [loading, setLoading] = useState(true);
  const [movieDetails, setMovieDetails] = useState<MovieDetails | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<SeriesDetails | null>(null);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    setMovieDetails(null);
    setSeriesDetails(null);

    const load = async () => {
      try {
        if (item.type === 'series') {
          const details = await fetchSeriesDetails(connection, item);
          if (!cancelled) {
            setSeriesDetails(details);
            if (details.seasons.length > 0) {
              setSelectedSeasonNum(details.seasons[0].seasonNumber);
            }
          }
        } else {
          const details = await fetchMovieDetails(connection, item);
          if (!cancelled) {
            setMovieDetails(details);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : 'No se pudieron cargar los detalles.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [connection, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const movieProgressKey = makeProgressKey(connection.id, item.type, item.id);
  const movieProgress = progressMap[movieProgressKey];

  // Buscar último episodio visto de la serie para botón "Continuar viendo"
  const lastWatchedEpisodeProgress = Object.values(progressMap)
    .filter((p) => p.connectionId === connection.id && p.itemId === item.id && p.episodeId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const activeSeason = seriesDetails?.seasons.find(
    (s) => s.seasonNumber === selectedSeasonNum
  );

  const displayPlot =
    movieDetails?.plot || seriesDetails?.plot || item.plot || '';
  const displayDirector =
    movieDetails?.director || seriesDetails?.director || item.director;
  const displayCast = movieDetails?.cast || seriesDetails?.cast || item.cast;
  const displayGenre = movieDetails?.genre || seriesDetails?.genre || item.genre;
  const displayDuration = movieDetails?.duration || item.duration;
  const displayExt =
    movieDetails?.containerExtension || item.containerExtension;
  const formatCheck = displayExt ? analyzeMediaFormat(displayExt) : null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11131B] shadow-2xl"
      >
        {/* Botón cerrar */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalles"
          className="absolute right-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-zinc-200 transition-colors hover:bg-black/90 hover:text-white"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="overflow-y-auto">
          {/* Encabezado visual */}
          <div className="relative grid gap-6 border-b border-white/[0.06] bg-gradient-to-br from-[#171926] via-[#11131B] to-[#0D0E14] p-6 sm:grid-cols-[200px_1fr] sm:p-8">
            <div className="mx-auto aspect-[2/3] w-40 overflow-hidden rounded-xl border border-white/10 bg-[#0B0C10] shadow-xl sm:mx-0 sm:w-full">
              <MediaPoster src={item.logo} alt={item.name} type={item.type} />
            </div>

            <div className="flex flex-col justify-end space-y-4">
              <div>
                <h2 className="font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
                  {item.name}
                </h2>

                {/* Metadatos unboxed con separadores tipográficos */}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400 tabular-nums">
                  <span>{item.type === 'series' ? 'Serie' : 'Película'}</span>
                  {item.year && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{item.year}</span>
                    </>
                  )}
                  {item.rating && item.rating > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                        {item.rating.toFixed(1)}
                      </span>
                    </>
                  )}
                  {displayDuration && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{displayDuration}</span>
                    </>
                  )}
                  {displayExt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono uppercase text-zinc-300">
                        {displayExt}
                      </span>
                    </>
                  )}
                  {item.categoryName && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{item.categoryName}</span>
                    </>
                  )}
                </div>
              </div>

              {displayPlot ? (
                <p className="text-sm leading-relaxed text-zinc-300">{displayPlot}</p>
              ) : (
                !loading && (
                  <p className="text-sm text-zinc-500">
                    Este título no incluye sinopsis en la respuesta actual del proveedor.
                  </p>
                )
              )}

              {(displayGenre || displayDirector || displayCast) && (
                <div className="space-y-1 text-xs text-zinc-400">
                  {displayGenre && (
                    <div>
                      <span className="text-zinc-500">Género: </span>
                      <span className="text-zinc-300">{displayGenre}</span>
                    </div>
                  )}
                  {displayDirector && (
                    <div>
                      <span className="text-zinc-500">Dirección: </span>
                      <span className="text-zinc-300">{displayDirector}</span>
                    </div>
                  )}
                  {displayCast && (
                    <div>
                      <span className="text-zinc-500">Reparto: </span>
                      <span className="line-clamp-2 text-zinc-300">{displayCast}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Aviso de compatibilidad MKV u otros contenedores */}
              {showFormatNotice && formatCheck && !formatCheck.browserCompatible && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                  <strong className="font-semibold">Compatibilidad del contenedor:</strong>{' '}
                  {formatCheck.reason} {formatCheck.recommendation}
                </div>
              )}

              {/* Acciones principales */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {item.type !== 'series' && (
                  <button
                    type="button"
                    onClick={() =>
                      onPlayMovie(item, movieProgress?.positionSeconds)
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-95"
                  >
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    {movieProgress && movieProgress.positionSeconds > 5
                      ? 'Reanudar película'
                      : 'Reproducir'}
                  </button>
                )}

                {item.type === 'series' &&
                  seriesDetails &&
                  seriesDetails.seasons.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const allEps = seriesDetails.seasons.flatMap((s) => s.episodes);
                        const resumeEp = lastWatchedEpisodeProgress
                          ? allEps.find(
                              (e) => e.id === lastWatchedEpisodeProgress.episodeId
                            )
                          : undefined;
                        const targetEp = resumeEp || allEps[0];
                        if (targetEp) {
                          onPlayEpisode(
                            item,
                            targetEp,
                            seriesDetails.seasons,
                            resumeEp ? lastWatchedEpisodeProgress.positionSeconds : undefined
                          );
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-95"
                    >
                      <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                      {lastWatchedEpisodeProgress
                        ? `Continuar: T${lastWatchedEpisodeProgress.seasonNumber} E${lastWatchedEpisodeProgress.episodeNumber}`
                        : 'Reproducir primer episodio'}
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => onToggleFavorite(item)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    isFavorite
                      ? 'border-blue-500/50 bg-blue-600/20 text-blue-300'
                      : 'border-white/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]'
                  }`}
                >
                  {isFavorite ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Bookmark className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isFavorite ? 'En Mi lista' : 'Agregar a Mi lista'}
                </button>
              </div>
            </div>
          </div>

          {/* Cuerpo: Cargando, errores, aviso de integración pendiente o Temporadas/Episodios */}
          <div className="p-6 sm:p-8">
            {loading && (
              <div className="flex items-center gap-3 py-6 text-sm text-zinc-400">
                <Loader2 className="h-5 w-5 animate-spin text-violet-400" aria-hidden="true" />
                Consultando información al proveedor...
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
                <div>
                  <p className="font-semibold">No se pudo cargar información extendida</p>
                  <p className="mt-1 text-xs text-rose-200/80">{errorMsg}</p>
                </div>
              </div>
            )}

            {!loading && movieDetails?.missingDetailsNotice && (
              <p className="text-xs text-zinc-400">{movieDetails.missingDetailsNotice}</p>
            )}

            {!loading && seriesDetails?.pendingIntegrationNotice && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
                <h3 className="font-display text-base font-semibold text-amber-200">
                  {seriesDetails.pendingIntegrationNotice.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">
                  {seriesDetails.pendingIntegrationNotice.description}
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-300">
                  {seriesDetails.pendingIntegrationNotice.missingEndpoints.map((ep) => (
                    <li key={ep}>{ep}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenConnections();
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-200 ring-1 ring-amber-500/40 transition-colors hover:bg-amber-500/30"
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                  Configurar endpoints en Mis conexiones
                </button>
              </div>
            )}

            {!loading && seriesDetails && seriesDetails.seasons.length > 0 && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold text-white">
                    Temporadas y episodios
                  </h3>

                  <div className="flex flex-wrap gap-1.5 rounded-lg bg-[#0B0C10] p-1">
                    {seriesDetails.seasons.map((season) => (
                      <button
                        key={season.seasonNumber}
                        type="button"
                        onClick={() => setSelectedSeasonNum(season.seasonNumber)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                          selectedSeasonNum === season.seasonNumber
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {season.name}
                      </button>
                    ))}
                  </div>
                </div>

                {activeSeason && (
                  <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-[#0D0F16]">
                    {activeSeason.episodes.map((ep) => {
                      const epProgressKey = makeProgressKey(
                        connection.id,
                        'series',
                        item.id,
                        ep.id
                      );
                      const epProgress = progressMap[epProgressKey];
                      const pct =
                        epProgress && epProgress.durationSeconds > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (epProgress.positionSeconds / epProgress.durationSeconds) *
                                  100
                              )
                            )
                          : 0;

                      return (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() =>
                            onPlayEpisode(
                              item,
                              ep,
                              seriesDetails.seasons,
                              epProgress?.positionSeconds
                            )
                          }
                          className="flex w-full items-center gap-4 p-3.5 text-left transition-colors hover:bg-white/[0.04]"
                        >
                          <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#151722]">
                            <MediaPoster
                              src={ep.thumbnail || item.logo}
                              alt={ep.title}
                              type="series"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                              <Play
                                className="h-5 w-5 fill-current text-white"
                                aria-hidden="true"
                              />
                            </div>
                            {pct > 0 && (
                              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                                <div
                                  className="h-full bg-violet-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-violet-400 tabular-nums">
                                E{ep.episodeNumber.toString().padStart(2, '0')}
                              </span>
                              <span className="truncate text-sm font-medium text-white">
                                {ep.title}
                              </span>
                            </div>
                            {ep.plot && (
                              <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
                                {ep.plot}
                              </p>
                            )}
                            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500 tabular-nums">
                              {ep.duration && <span>{ep.duration}</span>}
                              {ep.containerExtension && (
                                <>
                                  {ep.duration && <span aria-hidden="true">·</span>}
                                  <span className="uppercase">{ep.containerExtension}</span>
                                </>
                              )}
                              {pct > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-blue-400">{pct}% visto</span>
                                </>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
