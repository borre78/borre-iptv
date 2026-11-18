import {
  Bookmark,
  Check,
  Loader2,
  Play,
  Plug,
  Radio,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MediaPoster } from '../components/MediaPoster';
import { makeItemKey } from '../services/storageService';
import {
  CatalogCategory,
  CatalogItem,
  FavoriteItem,
  IptvConnection,
  NavSection,
} from '../types/iptv';

interface LiveTvViewProps {
  activeConnection: IptvConnection | null;
  channels: CatalogItem[];
  categories: CatalogCategory[];
  favorites: FavoriteItem[];
  pageSize: number;
  isLoading: boolean;
  onRetryLoad: () => void;
  onNavigate: (section: NavSection) => void;
  onPlayChannel: (channel: CatalogItem) => void;
  onToggleFavorite: (channel: CatalogItem) => void;
}

export function LiveTvView({
  activeConnection,
  channels,
  categories,
  favorites,
  pageSize,
  isLoading,
  onRetryLoad,
  onNavigate,
  onPlayChannel,
  onToggleFavorite,
}: LiveTvViewProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [search, selectedCategory, pageSize]);

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => f.key)),
    [favorites]
  );

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter((ch) => {
      if (selectedCategory !== 'all' && ch.categoryId !== selectedCategory) {
        return false;
      }
      if (q && !ch.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [channels, search, selectedCategory]);

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, visibleCount),
    [filteredChannels, visibleCount]
  );

  if (!activeConnection) {
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-[#11131B] p-8 text-center">
        <Plug className="h-10 w-10 text-violet-400" aria-hidden="true" />
        <h1 className="mt-4 font-display text-2xl font-bold text-white">
          TV en vivo sin proveedor activo
        </h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Agrega una lista M3U o una conexión Xtream Codes en Mis conexiones para ver
          canales en directo.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('connections')}
          className="mt-5 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
        >
          Configurar conexión
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-blue-400" aria-hidden="true" />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">TV en vivo</h1>
            <p className="text-xs text-zinc-400 tabular-nums">
              {filteredChannels.length} canales disponibles en {activeConnection.name}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRetryLoad}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#13141C] px-3.5 py-2 text-xs font-medium text-zinc-200 hover:border-blue-500/40 hover:text-white disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Actualizar canales
        </button>
      </div>

      {/* Buscador y filtro de grupo */}
      <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-[#11131B] p-4 sm:grid-cols-3">
        <div className="relative sm:col-span-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar canal por nombre..."
            aria-label="Buscar canal"
            className="w-full rounded-lg border border-white/10 bg-[#0B0C10] py-2 pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <select
          aria-label="Filtrar por categoría de TV"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="all">Todas las categorías</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading && channels.length === 0 ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#11131B] p-8">
          <Loader2 className="h-7 w-7 animate-spin text-blue-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-zinc-400">Cargando canales en vivo...</p>
        </div>
      ) : visibleChannels.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#11131B] p-10 text-center">
          <p className="font-display text-base font-semibold text-white">
            No hay canales en vivo disponibles
          </p>
          <p className="mx-auto mt-1.5 max-w-lg text-xs text-zinc-400">
            {channels.length === 0
              ? `El proveedor "${activeConnection.name}" no tiene un endpoint de TV en vivo configurado o su lista no contiene canales en directo.`
              : 'No se encontraron canales que coincidan con tu búsqueda.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleChannels.map((ch) => {
              const isFav = favoriteKeys.has(
                makeItemKey(ch.connectionId, ch.type, ch.id)
              );
              return (
                <div
                  key={`${ch.id}-${ch.name}`}
                  className="flex items-center gap-3.5 rounded-xl border border-white/[0.08] bg-[#11131B] p-3.5 transition-colors hover:border-blue-500/40"
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0B0C10]">
                    <MediaPoster src={ch.logo} alt={ch.name} type="live" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-white">
                      {ch.name}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-zinc-400">
                      {ch.categoryName || ch.categoryId}
                      {ch.containerExtension
                        ? ` · ${ch.containerExtension.toUpperCase()}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(ch)}
                      aria-label={
                        isFav ? 'Quitar de Mi lista' : 'Agregar a Mi lista'
                      }
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                        isFav
                          ? 'border-blue-500/40 bg-blue-600/20 text-blue-300'
                          : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {isFav ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Bookmark className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onPlayChannel(ch)}
                      aria-label={`Ver ${ch.name}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      Ver
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {visibleCount < filteredChannels.length && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + pageSize)}
                className="rounded-lg border border-blue-500/40 bg-blue-600/20 px-6 py-2.5 text-sm font-semibold text-blue-200 transition-colors hover:bg-blue-600/30"
              >
                Cargar más canales ({filteredChannels.length - visibleCount} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
