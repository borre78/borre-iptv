import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  DiagnosticDimensionState,
  DiscoveryReport,
  EndpointProbeStatus,
} from '../types/iptv';

interface DiscoveryResultsPanelProps {
  report: DiscoveryReport;
  isTesting?: boolean;
  onRetry?: () => void;
}

function getProbeBadge(status: EndpointProbeStatus) {
  switch (status) {
    case 'compatible':
      return {
        label: 'Compatible',
        textClass: 'text-emerald-400',
        Icon: CheckCircle2,
      };
    case 'not_found':
      return {
        label: 'No encontrado',
        textClass: 'text-zinc-400',
        Icon: XCircle,
      };
    case 'auth_required':
      return {
        label: 'Requiere autenticación',
        textClass: 'text-amber-400',
        Icon: Lock,
      };
    case 'cors_error':
      return {
        label: 'Error CORS',
        textClass: 'text-rose-400',
        Icon: AlertCircle,
      };
    case 'server_error':
      return {
        label: 'Error de servidor',
        textClass: 'text-rose-400',
        Icon: AlertTriangle,
      };
    case 'pending_config':
    default:
      return {
        label: 'Pendiente de configurar',
        textClass: 'text-amber-300',
        Icon: Clock,
      };
  }
}

function getDimensionVisual(state: DiagnosticDimensionState) {
  switch (state) {
    case 'ok':
      return {
        borderClass: 'border-emerald-500/25 bg-emerald-500/[0.06]',
        iconClass: 'text-emerald-400',
        Icon: CheckCircle2,
      };
    case 'warning':
      return {
        borderClass: 'border-amber-500/25 bg-amber-500/[0.06]',
        iconClass: 'text-amber-400',
        Icon: AlertTriangle,
      };
    case 'error':
      return {
        borderClass: 'border-rose-500/30 bg-rose-500/[0.07]',
        iconClass: 'text-rose-400',
        Icon: AlertCircle,
      };
    case 'pending':
    default:
      return {
        borderClass: 'border-white/[0.08] bg-[#0B0C10]',
        iconClass: 'text-zinc-400',
        Icon: Clock,
      };
  }
}

export function DiscoveryResultsPanel({
  report,
  isTesting = false,
  onRetry,
}: DiscoveryResultsPanelProps) {
  return (
    <div className="space-y-6">
      {/* Cabecera de resumen */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-white/10 bg-[#0D0F16] p-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 tabular-nums">
            <span className="font-semibold text-violet-300">
              Tipo detectado:{' '}
              {report.detectedType === 'xtream'
                ? 'Xtream Codes'
                : report.detectedType === 'm3u'
                ? 'M3U'
                : report.detectedPreset === 'netsky'
                ? 'API personalizada (Netsky)'
                : 'API personalizada'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Protocolo: {report.protocol}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-zinc-300">{report.domain}</span>
            <span aria-hidden="true">·</span>
            <span>
              Probado:{' '}
              {new Date(report.testedAt).toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            {report.viaBackend && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-blue-300">
                  Capa segura Express
                </span>
              </>
            )}
          </div>
          <p className="text-sm font-medium text-white">{report.summaryMessage}</p>
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isTesting}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isTesting ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Volver a probar
          </button>
        )}
      </div>

      {/* Desglose separado por tipo de error y capa de comunicación */}
      {report.categorizedErrors && report.categorizedErrors.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-sm font-semibold text-zinc-200">
            Desglose separado de comunicación y errores
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.categorizedErrors.map((cat) => {
              const vis = getDimensionVisual(cat.status);
              const CatIcon = vis.Icon;
              return (
                <div
                  key={cat.category}
                  className={`rounded-xl border p-4 ${vis.borderClass}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CatIcon
                        className={`h-4 w-4 shrink-0 ${vis.iconClass}`}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-semibold text-white">
                        {cat.label}
                      </span>
                    </div>
                    {cat.httpCode && (
                      <span className="font-mono text-xs text-zinc-300 tabular-nums">
                        {cat.httpCode}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-medium text-zinc-200">
                    {cat.summary}
                  </p>
                  {cat.detail && (
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      {cat.detail}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Diagnóstico visual en 7 dimensiones */}
      <div>
        <h3 className="mb-3 font-display text-sm font-semibold text-zinc-200">
          Diagnóstico de compatibilidad por módulo
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {report.dimensions.map((dim) => {
            const vis = getDimensionVisual(dim.state);
            const DimIcon = vis.Icon;
            return (
              <div
                key={dim.key}
                className={`rounded-xl border p-4 ${vis.borderClass}`}
              >
                <div className="flex items-center gap-2">
                  <DimIcon
                    className={`h-4 w-4 shrink-0 ${vis.iconClass}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold text-white">
                    {dim.label}
                  </span>
                </div>
                <p className="mt-2 text-xs font-medium text-zinc-200">
                  {dim.summary}
                </p>
                {dim.detail && (
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    {dim.detail}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Errores detectados */}
      {report.detectedErrors.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-rose-200">
            <AlertCircle className="h-4 w-4 text-rose-400" aria-hidden="true" />
            Errores detectados durante el análisis
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-200/90">
            {report.detectedErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabla de resultados de detección de endpoints */}
      <div className="space-y-2.5">
        <h3 className="font-display text-sm font-semibold text-zinc-200">
          Resultados de detección de endpoints ({report.probes.length})
        </h3>

        <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0B0C10]">
          <table className="w-full min-w-[780px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-[#11131B] text-zinc-400">
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-3 py-3 font-medium">Método HTTP</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="px-3 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Tipo de información</th>
                <th className="px-4 py-3 font-medium">Resultado de validación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {report.probes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    No se ejecutaron pruebas de endpoint para esta URL.
                  </td>
                </tr>
              ) : (
                report.probes.map((probe) => {
                  const badge = getProbeBadge(probe.status);
                  const BadgeIcon = badge.Icon;
                  return (
                    <tr
                      key={probe.id}
                      className="transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="max-w-[260px] truncate px-4 py-3 font-mono text-zinc-200" title={probe.endpoint}>
                        {probe.endpoint}
                      </td>
                      <td className="px-3 py-3 font-mono text-zinc-400">
                        {probe.method}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 font-medium ${badge.textClass}`}
                        >
                          <BadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-zinc-300 tabular-nums">
                        {probe.httpCode}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {probe.detectedDataType}
                      </td>
                      <td className="px-4 py-3 leading-relaxed text-zinc-400">
                        {probe.validationResult}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notas de seguridad */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0D0F16] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <ShieldCheck className="h-4 w-4 text-blue-400" aria-hidden="true" />
          Seguridad y transparencia del diagnóstico
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-400">
          {report.securityNotes.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
