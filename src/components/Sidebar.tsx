import {
  Activity,
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Clapperboard,
  Clock,
  Film,
  History,
  Home,
  Plug,
  Radio,
  RefreshCw,
  Settings,
  Tv,
  X,
} from 'lucide-react';
import { KeyboardEvent, useRef } from 'react';
import { IptvConnection, NavSection } from '../types/iptv';

interface SidebarProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  connections: IptvConnection[];
  activeConnection: IptvConnection | null;
  onSelectConnection: (id: string) => void;
  onRefreshCatalog: () => void;
  isCatalogLoading: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof Home;
}> = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'live', label: 'TV en vivo', icon: Radio },
  { id: 'movies', label: 'Películas', icon: Film },
  { id: 'series', label: 'Series', icon: Tv },
  { id: 'mylist', label: 'Mi lista', icon: Bookmark },
  { id: 'history', label: 'Historial', icon: History },
  { id: 'connections', label: 'Mis conexiones', icon: Plug },
  { id: 'diagnostics', label: 'Autodetección', icon: Activity },
  { id: 'settings', label: 'Configuración', icon: Settings },
];

function getStatusLabel(conn: IptvConnection): {
  text: string;
  colorClass: string;
  Icon: typeof CheckCircle2;
} {
  switch (conn.status) {
    case 'connected':
      return {
        text: 'Conectado',
        colorClass: 'text-emerald-400',
        Icon: CheckCircle2,
      };
    case 'pending_config':
      return {
        text: 'Config. pendiente',
        colorClass: 'text-amber-400',
        Icon: Clock,
      };
    case 'cors_error':
      return {
        text: 'Error CORS',
        colorClass: 'text-rose-400',
        Icon: AlertCircle,
      };
    case 'auth_error':
      return {
        text: 'Error de acceso',
        colorClass: 'text-rose-400',
        Icon: AlertCircle,
      };
    case 'network_error':
      return {
        text: 'Error de red',
        colorClass: 'text-rose-400',
        Icon: AlertCircle,
      };
    default:
      return {
        text: 'Sin probar',
        colorClass: 'text-zinc-400',
        Icon: Clock,
      };
  }
}

export function Sidebar({
  activeSection,
  onNavigate,
  connections,
  activeConnection,
  onSelectConnection,
  onRefreshCatalog,
  isCatalogLoading,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleNavKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (index + 1) % NAV_ITEMS.length;
      navRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (index - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
      navRefs.current[prev]?.focus();
    }
  };

  const statusMeta = activeConnection ? getStatusLabel(activeConnection) : null;

  const sidebarContent = (
    <div className="flex h-full w-64 flex-col border-r border-white/[0.08] bg-[#0D0E14]">
      {/* Marca principal */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-5">
        <button
          type="button"
          onClick={() => {
            onNavigate('home');
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-left focus-visible:outline-none"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-md shadow-violet-950/50">
            <Clapperboard className="h-5 w-5" aria-hidden="true" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            NEXUS IPTV
          </span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Cerrar menú lateral"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Selector de proveedor activo */}
      <div className="border-b border-white/[0.06] px-4 py-4">
        <label
          htmlFor="active-provider-select"
          className="block text-xs font-medium text-zinc-400"
        >
          Proveedor activo
        </label>

        {connections.length > 0 ? (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <select
                id="active-provider-select"
                value={activeConnection?.id || ''}
                onChange={(e) => onSelectConnection(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#141620] px-2.5 py-2 text-xs font-medium text-white transition-colors hover:border-violet-500/40 focus:border-blue-500 focus:outline-none"
              >
                {connections.map((conn) => (
                  <option key={conn.id} value={conn.id} className="bg-[#141620]">
                    {conn.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onRefreshCatalog}
                disabled={isCatalogLoading || !activeConnection}
                title="Actualizar catálogo desde el proveedor"
                aria-label="Actualizar catálogo desde el proveedor"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#141620] text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-white disabled:opacity-40"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isCatalogLoading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </div>

            {statusMeta && (
              <div className="flex items-center gap-1.5 px-0.5 text-xs">
                <statusMeta.Icon
                  className={`h-3.5 w-3.5 shrink-0 ${statusMeta.colorClass}`}
                  aria-hidden="true"
                />
                <span className={statusMeta.colorClass}>{statusMeta.text}</span>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onNavigate('connections');
              onCloseMobile();
            }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
          >
            <Plug className="h-3.5 w-3.5" aria-hidden="true" />
            Añadir proveedor
          </button>
        )}
      </div>

      {/* Navegación principal */}
      <nav aria-label="Menú principal" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item, idx) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              ref={(el) => {
                navRefs.current[idx] = el;
              }}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                onCloseMobile();
              }}
              onKeyDown={(e) => handleNavKeyDown(e, idx)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-gradient-to-r from-violet-600/25 to-blue-600/15 text-white ring-1 ring-violet-500/40'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  isActive ? 'text-violet-400' : 'text-zinc-400'
                }`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Pie discreto */}
      <div className="border-t border-white/[0.06] px-5 py-3.5 text-xs text-zinc-500">
        Configuración local en este navegador
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block lg:shrink-0">{sidebarContent}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
