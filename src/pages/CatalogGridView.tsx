import {
  Film,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tv,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MediaCard } from '../components/MediaCard';
import { makeItemKey } from '../services/storageService';
import {
  CatalogCategory,
  CatalogItem,
  FavoriteItem,
  IptvConnection,
  NavSection,
} from '../types/iptv';

type SortOption = 'added_desc' | 'rating_desc' | 'year_desc' | 'name_asc' | 'name_desc';

interface CatalogGridViewProps {
  mediaType: 'movie' | 'series';
  activeConnection: IptvConnection | null;
  items: CatalogItem[];
  categories: CatalogCategory[];
  favorites: FavoriteItem[];
  pageSize: number;
  isLoading: boolean;
  onRetryLoad: () => void;
  onNavigate: (section: NavSection) => void;
  onSelectItem: (item: CatalogItem) => void;
  onQuickPlay: (item: CatalogItem) => void;
  onToggleFavorite: (item: CatalogItem) => void;
}

export function CatalogGridView({
  mediaType,
  activeConnection,
  items,
  categories,
  favorites,
  pageSize,
  isLoading,
  onRetryLoad,
  onNavigate,
  onSelectItem,
  onQuickPlay,
  onToggleFavorite,
}: CatalogGridViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedFormat, setSelectedFormat] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('added_desc');
  const [visibleCount, setVisibleCount] = useState(pageSize);

  // Reiniciar paginación al cambiar filtros o pestaña
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [mediaType, searchQuery, selectedCategory, selectedYear, selectedFormat, sortBy, pageSize]);

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => f.key)),
    [favorites]
  );

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach((i) => {
      if (i.year && /^\d{4}$/.test(i.year)) years.add(i.year);
    });
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [items]);

  const availableFormats = useMemo(() => {
    const fmts = new Set<string>();
    items.forEach((i) => {
      if (i.containerExtension) fmts.add(i.containerExtension.toLowerCase());
    });
    return Array.from(fmts).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = items.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) {
        return false;
      }
      if (selectedYear !== 'all' && item.year !== selectedYear) {
        return false;
      }
      if (
        selectedFormat !== 'all' &&
        (item.containerExtension || '').toLowerCase() !== selectedFormat
      ) {
        return false;
      }
      if (q && !item.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      switch (sortBy) {
        case 'name_asc':
          return a.name.localeCompare(b.name, 'es');
        case 'name_desc':
          return b.name.localeCompare(a.name, 'es');
        case 'year_desc':
          return Number(b.year || 0) - Number(a.year || 0);
        case 'rating_desc':
          return (b.rating || 0) - (a.rating || 0);
        case 'added_desc':
        default:
          return (b.added || 0) - (a.added || 0);
      }
    });
  }, [items, searchQuery, selectedCategory, selectedFormat, selectedYear, sortBy]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );

  const TitleIcon = mediaType === 'movie' ? Film : Tv;
  const pageTitle = mediaType === 'movie' ? 'Películas' : 'Series';

  if (!activeConnection) {
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-[#11131B] p-8 text-center">
        <Plug className="h-10 w-10 text-violet-400" aria-hidden="true" />
        <h1 className="mt-4 font-display text-2xl font-bold text-white">
          Sin proveedor configurado
        </h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Para explorar el catálogo de {pageTitle.toLowerCase()}, primero registra y
          activa una conexión IPTV compatible.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('connections')}
          className="mt-5 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
        >
          Ir a Mis conexiones
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <TitleIcon className="h-6 w-6 text-violet-400" aria-hidden="true" />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">{pageTitle}</h1>
            <p className="text-xs text-zinc-400 tabular-nums">
              {filteredItems.length} de {items.length} títulos disponibles en{' '}
              {activeConnection.name}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRetryLoad}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#13141C] px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-violet-500/40 hover:text-white disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Actualizar catálogo
        </button>
      </div>

      {/* Barra de búsqueda, filtros y ordenamiento */}
      <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-[#11131B] p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Buscar ${pageTitle.toLowerCase()} por nombre...`}
            aria-label={`Buscar ${pageTitle.toLowerCase()}`}
            className="w-full rounded-lg border border-white/10 bg-[#0B0C10] py-2 pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <select
          aria-label="Filtrar por categoría"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="all">Todas las categorías</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
              {cat.count !== undefined ? ` (${cat.count})` : ''}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <select
            aria-label="Filtrar por año"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="w-1/2 rounded-lg border border-white/10 bg-[#0B0C10] px-2.5 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">Año: Todos</option>
            {availableYears.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por formato"
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value)}
            className="w-1/2 rounded-lg border border-white/10 bg-[#0B0C10] px-2.5 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">Formato</option>
            {availableFormats.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal
            className="h-4 w-4 shrink-0 text-zinc-500"
            aria-hidden="true"
          />
          <select
            aria-label="Ordenar catálogo"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="added_desc">Agregados recientemente</option>
            <option value="rating_desc">Popularidad / Calificación</option>
            <option value="year_desc">Año más reciente</option>
            <option value="name_asc">Nombre (A–Z)</option>
            <option value="name_desc">Nombre (Z–A)</option>
          </select>
        </div>
      </div>

      {/* Estado de carga o grid */}
      {isLoading && items.length === 0 ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#11131B] p-8">
          <Loader2 className="h-7 w-7 animate-spin text-violet-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-zinc-400">
            Cargando {pageTitle.toLowerCase()}...
          </p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#11131B] p-10 text-center">
          <p className="font-display text-base font-semibold text-white">
            No se encontraron resultados
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {items.length === 0
              ? `El proveedor "${activeConnection.name}" no devolvió ${pageTitle.toLowerCase()} o el endpoint aún no está configurado.`
              : 'Prueba ajustando el texto de búsqueda o los filtros seleccionados.'}
          </p>
          {(searchQuery || selectedCategory !== 'all' || selectedYear !== 'all' || selectedFormat !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setSelectedYear('all');
                setSelectedFormat('all');
              }}
              className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-white/5"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {visibleItems.map((item) => (
              <div key={`${item.type}-${item.id}`} className="flex justify-center">
                <MediaCard
                  item={item}
                  isFavorite={favoriteKeys.has(
                    makeItemKey(item.connectionId, item.type, item.id)
                  )}
                  onSelect={onSelectItem}
                  onQuickPlay={
                    mediaType === 'movie' ? (it) => onQuickPlay(it) : undefined
                  }
                  onToggleFavorite={onToggleFavorite}
                />
              </div>
            ))}
          </div>

          {visibleCount < filteredItems.length && (
            <div className="flex flex-col items-center gap-2 pt-4">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + pageSize)}
                className="rounded-lg border border-violet-500/40 bg-violet-600/20 px-6 py-2.5 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-600/30"
              >
                Cargar más ({filteredItems.length - visibleCount} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
