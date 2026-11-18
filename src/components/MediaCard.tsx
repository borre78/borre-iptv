import { Bookmark, Check, Play, Star } from 'lucide-react';
import { CatalogItem, PlaybackProgress } from '../types/iptv';
import { MediaPoster } from './MediaPoster';

interface MediaCardProps {
  item: CatalogItem;
  progress?: PlaybackProgress;
  rankIndex?: number;
  isFavorite?: boolean;
  onSelect: (item: CatalogItem) => void;
  onQuickPlay?: (item: CatalogItem) => void;
  onToggleFavorite?: (item: CatalogItem) => void;
  variant?: 'poster' | 'continue';
}

function formatTimeShort(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function MediaCard({
  item,
  progress,
  rankIndex,
  isFavorite = false,
  onSelect,
  onQuickPlay,
  onToggleFavorite,
  variant = 'poster',
}: MediaCardProps) {
  const progressPercent =
    progress && progress.durationSeconds > 0
      ? Math.min(
          100,
          Math.max(3, Math.round((progress.positionSeconds / progress.durationSeconds) * 100))
        )
      : 0;

  const metaParts: string[] = [];
  if (item.year) metaParts.push(item.year);
  if (item.rating && item.rating > 0) metaParts.push(`★ ${item.rating.toFixed(1)}`);
  if (item.containerExtension) metaParts.push(item.containerExtension.toUpperCase());

  return (
    <div
      className={`group relative flex shrink-0 flex-col ${
        variant === 'continue' ? 'w-64 sm:w-72' : 'w-40 sm:w-44 md:w-48'
      }`}
    >
      <div className="relative flex items-end">
        {rankIndex !== undefined && (
          <span
            aria-hidden="true"
            className="font-display pointer-events-none -mr-3 select-none pb-1 text-6xl font-extrabold leading-none tracking-tighter text-zinc-700/80 transition-colors group-hover:text-violet-500/80 tabular-nums"
          >
            {rankIndex}
          </span>
        )}

        <div
          className={`relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#13141C] transition-transform duration-200 ease-out group-hover:-translate-y-1 group-hover:border-violet-500/50 ${
            variant === 'continue' ? 'aspect-video' : 'aspect-[2/3]'
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(item)}
            aria-label={`Ver detalles de ${item.name}`}
            className="block h-full w-full text-left focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <MediaPoster src={item.logo} alt={item.name} type={item.type} />
          </button>

          {/* Scrim sutil en hover para legibilidad */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100" />

          {/* Barra de progreso para Continuar viendo */}
          {progress && progress.durationSeconds > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-white/15">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-blue-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}

          {/* Botones rápidos en hover o foco */}
          <div className="absolute inset-x-2.5 bottom-3 flex items-center justify-between gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            {onQuickPlay && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickPlay(item);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors hover:bg-violet-500 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                {variant === 'continue' ? 'Reanudar' : 'Reproducir'}
              </button>
            )}
            {onToggleFavorite && (
              <button
                type="button"
                aria-label={isFavorite ? 'Quitar de Mi lista' : 'Agregar a Mi lista'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(item);
                }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                  isFavorite
                    ? 'border-blue-500/50 bg-blue-600/90 text-white'
                    : 'border-white/15 bg-black/70 text-zinc-200 hover:bg-black/90'
                }`}
              >
                {isFavorite ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Título y metadatos limpios sin pills */}
      <div className="mt-2.5 px-0.5">
        <button
          type="button"
          onClick={() => onSelect(item)}
          className="line-clamp-1 text-left text-sm font-medium text-zinc-100 transition-colors hover:text-violet-400 focus-visible:outline-none"
          title={item.name}
        >
          {item.name}
        </button>

        {variant === 'continue' && progress ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400 tabular-nums">
            {progress.episodeTitle ? (
              <span className="truncate">{progress.episodeTitle}</span>
            ) : (
              <span>{progressPercent}% visto</span>
            )}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{formatTimeShort(progress.positionSeconds)}</span>
          </div>
        ) : (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400 tabular-nums">
            {metaParts.length > 0 ? (
              metaParts.map((part, idx) => (
                <span key={`${part}-${idx}`} className="inline-flex items-center gap-1.5">
                  {idx > 0 && <span aria-hidden="true">·</span>}
                  {part.startsWith('★') ? (
                    <span className="inline-flex items-center gap-0.5 text-amber-400">
                      <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                      {part.slice(2)}
                    </span>
                  ) : (
                    <span>{part}</span>
                  )}
                </span>
              ))
            ) : (
              <span>{item.type === 'series' ? 'Serie' : item.type === 'live' ? 'En vivo' : 'Película'}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
