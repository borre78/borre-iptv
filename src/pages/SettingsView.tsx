import {
  CheckCircle2,
  Database,
  Download,
  FileJson,
  Info,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import { ChangeEvent, useState } from 'react';
import {
  buildBackupPayload,
  clearCatalogCache,
  parseAndApplyBackup,
} from '../services/storageService';
import { UserPreferences } from '../types/iptv';

interface SettingsViewProps {
  preferences: UserPreferences;
  onUpdatePreferences: (next: UserPreferences) => void;
  onBackupImported: () => void;
}

export function SettingsView({
  preferences,
  onUpdatePreferences,
  onBackupImported,
}: SettingsViewProps) {
  const [includeSecretsOnExport, setIncludeSecretsOnExport] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleExportJson = () => {
    const payload = buildBackupPayload(includeSecretsOnExport);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexus-iptv-respaldo-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatusMessage({
      type: 'success',
      text: includeSecretsOnExport
        ? 'Respaldo JSON exportado con credenciales incluidas.'
        : 'Respaldo JSON exportado (contraseñas y tokens omitidos por seguridad).',
    });
  };

  const handleImportJson = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      const result = parseAndApplyBackup(raw);
      if (result.ok) {
        setStatusMessage({ type: 'success', text: result.message });
        onBackupImported();
      } else {
        setStatusMessage({ type: 'error', text: result.message });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClearCache = () => {
    clearCatalogCache();
    setStatusMessage({
      type: 'success',
      text: 'Caché local de catálogos eliminada. La próxima carga consultará directamente a tu proveedor.',
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-violet-400" aria-hidden="true" />
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Configuración</h1>
          <p className="text-xs text-zinc-400">
            Preferencias de reproducción, caché local y respaldo JSON en este navegador.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`flex items-center gap-2.5 rounded-xl border p-4 text-xs ${
            statusMessage.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Preferencias de reproducción y catálogo */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#11131B] p-6">
        <h2 className="font-display text-lg font-semibold text-white">
          Preferencias de reproducción y catálogo
        </h2>

        <div className="mt-5 divide-y divide-white/[0.06]">
          <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-white">
                Reproducir siguiente episodio automáticamente
              </p>
              <p className="text-xs text-zinc-400">
                Al finalizar un episodio de una serie, inicia el siguiente de forma
                continua.
              </p>
            </div>
            <input
              type="checkbox"
              checked={preferences.autoPlayNextEpisode}
              onChange={(e) =>
                onUpdatePreferences({
                  ...preferences,
                  autoPlayNextEpisode: e.target.checked,
                })
              }
              className="h-4 w-4 rounded accent-violet-600"
            />
          </label>

          <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-white">
                Mostrar avisos de compatibilidad de formato (MKV / TS)
              </p>
              <p className="text-xs text-zinc-400">
                Advierte en la ficha de detalles si el contenedor no es reproducible
                directamente por navegadores HTML5.
              </p>
            </div>
            <input
              type="checkbox"
              checked={preferences.showFormatBadgesInDetail}
              onChange={(e) =>
                onUpdatePreferences({
                  ...preferences,
                  showFormatBadgesInDetail: e.target.checked,
                })
              }
              className="h-4 w-4 rounded accent-violet-600"
            />
          </label>

          <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-white">
                Caché local de catálogos (30 min)
              </p>
              <p className="text-xs text-zinc-400">
                Acelera la navegación en catálogos grandes almacenando una copia temporal
                en LocalStorage.
              </p>
            </div>
            <input
              type="checkbox"
              checked={preferences.enableLocalCache}
              onChange={(e) =>
                onUpdatePreferences({
                  ...preferences,
                  enableLocalCache: e.target.checked,
                })
              }
              className="h-4 w-4 rounded accent-violet-600"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-white">
                Volumen inicial del reproductor
              </p>
              <p className="text-xs text-zinc-400 tabular-nums">
                Nivel configurado: {Math.round(preferences.defaultVolume * 100)}%
              </p>
            </div>
            <input
              type="range"
              aria-label="Volumen inicial"
              min={0}
              max={1}
              step={0.05}
              value={preferences.defaultVolume}
              onChange={(e) =>
                onUpdatePreferences({
                  ...preferences,
                  defaultVolume: Number(e.target.value),
                })
              }
              className="w-40 accent-violet-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-white">
                Elementos por página en catálogo
              </p>
              <p className="text-xs text-zinc-400">
                Controla la carga progresiva para mantener la fluidez en listas extensas.
              </p>
            </div>
            <select
              aria-label="Elementos por página"
              value={preferences.catalogPageSize}
              onChange={(e) =>
                onUpdatePreferences({
                  ...preferences,
                  catalogPageSize: Number(e.target.value),
                })
              }
              className="rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white"
            >
              <option value={24}>24 títulos</option>
              <option value={36}>36 títulos</option>
              <option value={60}>60 títulos</option>
              <option value={96}>96 títulos</option>
            </select>
          </div>
        </div>
      </section>

      {/* Exportar e importar configuración JSON */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#11131B] p-6">
        <div className="flex items-center gap-2.5">
          <FileJson className="h-5 w-5 text-blue-400" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-white">
            Exportar e importar configuración (JSON)
          </h2>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Cada navegador mantiene su configuración independiente en LocalStorage. Puedes
          exportar tus conexiones, favoritos, historial, progreso y preferencias a un
          archivo JSON o restaurarlas en otro equipo.
        </p>

        <label className="mt-4 inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={includeSecretsOnExport}
            onChange={(e) => setIncludeSecretsOnExport(e.target.checked)}
            className="h-4 w-4 rounded accent-violet-600"
          />
          Incluir contraseñas y tokens en el archivo exportado (recomendado desactivar si
          vas a compartir la estructura)
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar configuración JSON
          </button>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10">
            <Upload className="h-4 w-4 text-blue-400" aria-hidden="true" />
            Importar respaldo JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleImportJson}
              className="sr-only"
            />
          </label>

          <button
            type="button"
            onClick={handleClearCache}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#0B0C10] px-4 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-rose-500/40 hover:text-rose-200"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Limpiar caché local
          </button>
        </div>
      </section>

      {/* Documentación de compatibilidad e integraciones */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#11131B] p-6">
        <div className="flex items-center gap-2.5">
          <Info className="h-5 w-5 text-violet-400" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-white">
            Compatibilidad técnica y documentación de proveedores
          </h2>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-[#0B0C10] p-4">
            <h3 className="text-sm font-semibold text-white">
              Estado de integración Netsky
            </h3>
            <ul className="mt-2 space-y-1.5 text-xs text-zinc-400">
              <li>
                <strong className="text-zinc-200">Rutas integradas:</strong>{' '}
                <code className="font-mono text-zinc-300">
                  /api/player/catalog/{'{catalogId}'}/items?type=movie|series
                </code>
              </li>
              <li>
                <strong className="text-zinc-200">Pendientes de configuración:</strong>{' '}
                autenticación de sesión, detalles extendidos, temporadas/episodios y
                obtención de fuente de streaming. Pueden añadirse manualmente en Mis
                conexiones sin modificar código.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-[#0B0C10] p-4">
            <h3 className="text-sm font-semibold text-white">
              Reproducción en navegador (HLS.js, HTML5, MKV y CORS)
            </h3>
            <ul className="mt-2 space-y-1.5 text-xs text-zinc-400">
              <li>
                <strong className="text-zinc-200">Compatibles:</strong> HLS (.m3u8 vía
                HLS.js) y contenedores web nativos (.mp4, .webm, .ogg).
              </li>
              <li>
                <strong className="text-zinc-200">MKV y TS directo:</strong> los
                navegadores no decodifican MKV directamente; el proveedor debe entregar
                HLS (.m3u8) o MP4 compatible.
              </li>
              <li>
                <strong className="text-zinc-200">CORS:</strong> el servidor del proveedor
                debe responder con <code className="font-mono">Access-Control-Allow-Origin</code>.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
          <Database className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            Almacenamiento 100% en navegador mediante LocalStorage; sin bases de datos
            externas.
          </span>
        </div>
      </section>
    </div>
  );
}
