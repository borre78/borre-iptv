import { Bookmark, History, Play, Trash2 } from 'lucide-react';
import { MediaCard } from '../components/MediaCard';
import { MediaPoster } from '../components/MediaPoster';
import {
  CatalogItem,
  FavoriteItem,
  PlaybackProgress,
  WatchHistoryEntry,
} from '../types/iptv';
import { makeProgressKey } from '../services/storageService';

interface MyListViewProps {
  favorites: FavoriteItem[];
  onSelectItem: (item: CatalogItem) => void;
  onQuickPlay: (item: CatalogItem) => void;
  onToggleFavorite: (item: CatalogItem) => void;
}

export function MyListView({
  favorites,
  onSelectItem,
  onQuickPlay,
  onToggleFavorite,
}: MyListViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bookmark className="h-6 w-6 text-violet-400" aria-hidden="true" />
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Mi lista</h1>
          <p className="text-xs text-zinc-400 tabular-nums">
            {favorites.length} títulos guardados en este navegador
          </p>
        </div>
      </div>

      {favorites.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-[#11131B] p-12 text-center">
          <Bookmark className="mx-auto h-9 w-9 text-zinc-500" aria-hidden="true" />
          <h2 className="mt-4 font-display text-lg font-semibold text-white">
            Tu lista está vacía
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-400">
            Guarda películas, series o canales desde cualquier tarjeta o vista de detalles
            para acceder rápido a ellos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {favorites.map(({ key, item }) => (
            <div key={key} className="flex justify-center">
              <MediaCard
                item={item}
                isFavorite
                onSelect={onSelectItem}
                onQuickPlay={(it) =>
                  it.type === 'series' ? onSelectItem(it) : onQuickPlay(it)
                }
                onToggleFavorite={onToggleFavorite}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface HistoryViewProps {
  history: WatchHistoryEntry[];
  progressMap: Record<string, PlaybackProgress>;
  onSelectHistoryItem: (entry: WatchHistoryEntry) => void;
  onClearHistory: () => void;
}

export function HistoryView({
  history,
  progressMap,
  onSelectHistoryItem,
  onClearHistory,
}: HistoryViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-blue-400" aria-hidden="true" />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">Historial</h1>
            <p className="text-xs text-zinc-400 tabular-nums">
              {history.length} reproducciones registradas localmente
            </p>
          </div>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Limpiar historial
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-[#11131B] p-12 text-center">
          <History className="mx-auto h-9 w-9 text-zinc-500" aria-hidden="true" />
          <h2 className="mt-4 font-display text-lg font-semibold text-white">
            Sin historial de reproducción
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-400">
            Aquí aparecerán las películas, episodios y canales en vivo que reproduzcas
            desde este navegador.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-[#11131B]">
          {history.map((entry) => {
            const pKey = makeProgressKey(
              entry.connectionId,
              entry.type,
              entry.itemId,
              entry.episodeId
            );
            const prog = progressMap[pKey];
            const pct =
              prog && prog.durationSeconds > 0
                ? Math.min(
                    100,
                    Math.round((prog.positionSeconds / prog.durationSeconds) * 100)
                  )
                : 0;

            return (
              <div
                key={entry.key}
                className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/[0.02]"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0B0C10]">
                    <MediaPoster
                      src={entry.logo}
                      alt={entry.name}
                      type={entry.type}
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-white">
                      {entry.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400 tabular-nums">
                      <span>
                        {entry.type === 'live'
                          ? 'TV en vivo'
                          : entry.type === 'series'
                          ? 'Serie'
                          : 'Película'}
                      </span>
                      {entry.episodeTitle && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            T{entry.seasonNumber} E{entry.episodeNumber}:{' '}
                            {entry.episodeTitle}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(entry.watchedAt).toLocaleString('es-ES', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                      {pct > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-violet-400">{pct}% visto</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectHistoryItem(entry)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600/20 px-3.5 py-2 text-xs font-semibold text-violet-200 ring-1 ring-violet-500/40 transition-colors hover:bg-violet-600/30"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  Abrir
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
