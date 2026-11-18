import {
  Activity,
  Edit3,
  Loader2,
  Plug,
  Radar,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { DiscoveryResultsPanel } from '../components/DiscoveryResultsPanel';
import { NetskySessionPanel } from '../components/NetskySessionPanel';
import { providerDiscoveryService } from '../services/providerDiscoveryService';
import { DiscoveryReport, IptvConnection } from '../types/iptv';

interface DiagnosticsViewProps {
  connections: IptvConnection[];
  selectedConnectionId: string | null;
  onSelectConnectionId: (id: string) => void;
  onUpdateConnectionWithReport: (
    connectionId: string,
    report: DiscoveryReport
  ) => void;
  onNavigateToConnections: () => void;
}

export function DiagnosticsView({
  connections,
  selectedConnectionId,
  onSelectConnectionId,
  onUpdateConnectionWithReport,
  onNavigateToConnections,
}: DiagnosticsViewProps) {
  const [isRunning, setIsRunning] = useState(false);

  const targetConnection =
    connections.find((c) => c.id === selectedConnectionId) ||
    connections[0] ||
    null;

  const runDiscoveryForConnection = async (conn: IptvConnection) => {
    setIsRunning(true);
    try {
      const report = await providerDiscoveryService.discover({
        connectionId: conn.id,
        name: conn.name,
        serverUrl: conn.serverUrl,
        requestedType: conn.type,
        communicationMode: conn.communicationMode,
        username: conn.username,
        password: conn.password,
        token: conn.token,
        catalogId: conn.catalogId,
        m3uUrl: conn.m3uUrl,
        m3uRawContent: conn.m3uRawContent,
        customEndpoints: conn.customEndpoints,
      });
      onUpdateConnectionWithReport(conn.id, report);
    } finally {
      setIsRunning(false);
    }
  };

  // Si la conexión seleccionada aún no tiene reporte ejecutado en esta vista, ofrecer ejecución manual o automática limpia
  useEffect(() => {
    if (targetConnection && !targetConnection.lastDiscoveryReport && !isRunning) {
      // No auto-disparar red sin clic si tiene error previo; si es la primera vista de Netsky o conexión sin probar, ejecutar diagnóstico inicial real
      runDiscoveryForConnection(targetConnection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetConnection?.id]);

  if (!targetConnection) {
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-[#11131B] p-8 text-center">
        <Plug className="h-10 w-10 text-violet-400" aria-hidden="true" />
        <h1 className="mt-4 font-display text-2xl font-bold text-white">
          Sin proveedores para diagnosticar
        </h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Registra o importa primero una conexión IPTV para analizar sus endpoints y
          compatibilidad en navegador.
        </p>
        <button
          type="button"
          onClick={onNavigateToConnections}
          className="mt-5 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
        >
          Ir a Mis conexiones
        </button>
      </div>
    );
  }

  const report = targetConnection.lastDiscoveryReport;

  return (
    <div className="space-y-6">
      {/* Encabezado y selector de proveedor */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-violet-400" aria-hidden="true" />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">
              Autodetección y diagnóstico
            </h1>
            <p className="text-xs text-zinc-400">
              Análisis real de endpoints, validación de respuestas JSON/M3U, CORS y
              compatibilidad del reproductor.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Seleccionar proveedor a diagnosticar"
            value={targetConnection.id}
            onChange={(e) => onSelectConnectionId(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#11131B] px-3.5 py-2 text-xs font-medium text-white focus:border-blue-500 focus:outline-none"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type === 'xtream' ? 'Xtream' : c.type === 'm3u' ? 'M3U' : 'API pers.'})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onNavigateToConnections}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#11131B] px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-white/5"
          >
            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
            Editar conexión
          </button>

          <button
            type="button"
            onClick={() => runDiscoveryForConnection(targetConnection)}
            disabled={isRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition-opacity hover:opacity-95 disabled:opacity-50"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Radar className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Volver a probar
          </button>
        </div>
      </div>

      {/* Sesión en memoria cuando es API personalizada */}
      {targetConnection.type === 'custom_api' && (
        <NetskySessionPanel
          connection={targetConnection}
          onEditConnection={onNavigateToConnections}
          onSessionActivated={() => runDiscoveryForConnection(targetConnection)}
          onSessionLoggedOut={() => runDiscoveryForConnection(targetConnection)}
        />
      )}

      {/* Estado en ejecución */}
      {isRunning && !report ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-[#11131B] p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-violet-400" aria-hidden="true" />
          <p className="mt-4 font-display text-base font-semibold text-white">
            Ejecutando autodetección sobre {targetConnection.name}...
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Normalizando URL, probando endpoints disponibles y validando estructuras JSON.
          </p>
        </div>
      ) : report ? (
        <DiscoveryResultsPanel
          report={report}
          isTesting={isRunning}
          onRetry={() => runDiscoveryForConnection(targetConnection)}
        />
      ) : null}
    </div>
  );
}
