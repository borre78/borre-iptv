import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  PlayCircle,
  Plug,
  Plus,
  Radar,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useState } from 'react';
import { DiscoveryResultsPanel } from '../components/DiscoveryResultsPanel';
import { NetskySessionPanel } from '../components/NetskySessionPanel';
import { testProviderConnection } from '../services/adapters';
import { providerDiscoveryService } from '../services/providerDiscoveryService';
import {
  CommunicationMode,
  ConnectionInputType,
  ConnectionStatus,
  ConnectionTestResult,
  CustomEndpointsConfig,
  DiscoveryReport,
  IptvConnection,
  ProviderPreset,
  ProviderType,
  TokenTransportMechanism,
} from '../types/iptv';

interface ConnectionsViewProps {
  connections: IptvConnection[];
  activeConnectionId: string | null;
  onSaveConnection: (conn: IptvConnection) => void;
  onDeleteConnection: (id: string) => void;
  onActivateConnection: (id: string) => void;
  onOpenDiagnostics: (connectionId: string) => void;
  onRefreshActiveCatalog?: (connectionId: string) => void;
}

interface ConnectionFormState {
  id?: string;
  name: string;
  inputType: ConnectionInputType;
  preset: ProviderPreset;
  communicationMode: CommunicationMode;
  serverUrl: string;
  username: string;
  password: string;
  token: string;
  rememberSecretsInBrowser: boolean;
  catalogId: string;
  m3uUrl: string;
  m3uRawContent: string;
  customEndpoints: CustomEndpointsConfig;
}

const EMPTY_FORM: ConnectionFormState = {
  name: '',
  inputType: 'auto',
  preset: 'custom_generic',
  communicationMode: 'backend_secure',
  serverUrl: '',
  username: '',
  password: '',
  token: '',
  rememberSecretsInBrowser: false,
  catalogId: '',
  m3uUrl: '',
  m3uRawContent: '',
  customEndpoints: {},
};

function getPresetDefaults(preset: ProviderPreset): Partial<ConnectionFormState> {
  switch (preset) {
    case 'netsky':
      return {
        inputType: 'custom_api',
        preset: 'netsky',
        communicationMode: 'backend_secure',
        name: 'Netsky',
        customEndpoints: {
          loginIptvMethod: 'POST',
          profileSessionEndpoint: '/api/v1/profiles/{profileId}/session',
          tokenTransport: 'unconfirmed',
          sessionTokenSource: 'profile_token',
          accountEndpoint: '/api/player/catalog/{catalogId}/account',
          moviesEndpoint: '/api/player/catalog/{catalogId}/items?type=movie',
          seriesEndpoint: '/api/player/catalog/{catalogId}/items?type=series',
          authHeaderName: 'Authorization',
          tokenPrefix: 'Bearer',
        },
      };
    case 'kaelus':
      return {
        inputType: 'custom_api',
        preset: 'kaelus',
        name: 'Kaelus',
        customEndpoints: {
          authHeaderName: 'Authorization',
          tokenPrefix: 'Bearer',
        },
      };
    case 'm3u_url':
      return {
        inputType: 'm3u',
        preset: 'm3u_url',
        name: 'Lista M3U',
        customEndpoints: {},
      };
    case 'm3u_file':
      return {
        inputType: 'm3u',
        preset: 'm3u_file',
        name: 'Archivo M3U local',
        customEndpoints: {},
      };
    case 'custom_generic':
      return {
        inputType: 'auto',
        preset: 'custom_generic',
        name: 'Proveedor IPTV',
        customEndpoints: {
          authHeaderName: 'Authorization',
          tokenPrefix: 'Bearer',
        },
      };
    case 'xtream_standard':
    default:
      return {
        inputType: 'xtream',
        preset: 'xtream_standard',
        name: 'Proveedor Xtream Codes',
        customEndpoints: {},
      };
  }
}

function getStatusBadge(status: ConnectionStatus) {
  switch (status) {
    case 'connected':
      return {
        label: 'Conectado',
        classes: 'text-emerald-400',
        Icon: CheckCircle2,
      };
    case 'pending_config':
      return {
        label: 'Configuración pendiente',
        classes: 'text-amber-400',
        Icon: Clock,
      };
    case 'cors_error':
      return {
        label: 'Error CORS',
        classes: 'text-rose-400',
        Icon: AlertCircle,
      };
    case 'auth_error':
      return {
        label: 'Error de autenticación',
        classes: 'text-rose-400',
        Icon: AlertCircle,
      };
    case 'network_error':
      return {
        label: 'Error de red',
        classes: 'text-rose-400',
        Icon: AlertCircle,
      };
    default:
      return {
        label: 'Sin probar',
        classes: 'text-zinc-400',
        Icon: Clock,
      };
  }
}

export function ConnectionsView({
  connections,
  activeConnectionId,
  onSaveConnection,
  onDeleteConnection,
  onActivateConnection,
  onOpenDiagnostics,
  onRefreshActiveCatalog,
}: ConnectionsViewProps) {
  const [formOpen, setFormOpen] = useState(connections.length === 0);
  const [form, setForm] = useState<ConnectionFormState>(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvancedEndpoints, setShowAdvancedEndpoints] = useState(false);
  const [testingDraft, setTestingDraft] = useState(false);
  const [detectingApi, setDetectingApi] = useState(false);
  const [testingConnId, setTestingConnId] = useState<string | null>(null);
  const [draftTestResult, setDraftTestResult] = useState<ConnectionTestResult | null>(
    null
  );
  const [draftDiscoveryReport, setDraftDiscoveryReport] =
    useState<DiscoveryReport | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const openNewForm = (preset: ProviderPreset = 'custom_generic') => {
    const defaults = getPresetDefaults(preset);
    setForm({
      ...EMPTY_FORM,
      ...defaults,
      customEndpoints: defaults.customEndpoints || {},
    });
    setDraftTestResult(null);
    setDraftDiscoveryReport(null);
    setFormError(null);
    setShowAdvancedEndpoints(
      preset === 'netsky' || preset === 'kaelus' || preset === 'custom_generic'
    );
    setFormOpen(true);
  };

  const openEditForm = (conn: IptvConnection) => {
    setForm({
      id: conn.id,
      name: conn.name,
      inputType: conn.type,
      preset: conn.preset,
      communicationMode:
        conn.communicationMode ||
        (conn.preset === 'netsky' ? 'backend_secure' : 'direct_browser'),
      serverUrl: conn.serverUrl || '',
      username: conn.username || '',
      password: conn.password || '',
      token: conn.token || '',
      rememberSecretsInBrowser: Boolean(conn.rememberSecretsInBrowser),
      catalogId: conn.catalogId || '',
      m3uUrl: conn.m3uUrl || '',
      m3uRawContent: conn.m3uRawContent || '',
      customEndpoints: conn.customEndpoints || {},
    });
    setDraftTestResult(null);
    setDraftDiscoveryReport(conn.lastDiscoveryReport || null);
    setFormError(null);
    setShowAdvancedEndpoints(conn.type === 'custom_api');
    setFormOpen(true);
  };

  const resolveEffectiveType = (): ProviderType => {
    if (form.inputType === 'auto') {
      if (draftDiscoveryReport) return draftDiscoveryReport.detectedType;
      if (form.m3uRawContent.trim() || /\.m3u8?(\?|$)/i.test(form.m3uUrl || form.serverUrl)) {
        return 'm3u';
      }
      if (form.username.trim() && form.password && !form.catalogId.trim()) {
        return 'xtream';
      }
      return 'custom_api';
    }
    return form.inputType;
  };

  const buildConnectionObject = (
    testRes?: ConnectionTestResult | null,
    discovery?: DiscoveryReport | null
  ): IptvConnection => {
    const existing = form.id
      ? connections.find((c) => c.id === form.id)
      : undefined;
    const now = Date.now();
    const effectiveType = discovery ? discovery.detectedType : resolveEffectiveType();
    const effectivePreset = discovery ? discovery.detectedPreset : form.preset;
    const effectiveM3uUrl =
      effectiveType === 'm3u'
        ? form.m3uUrl.trim() || form.serverUrl.trim() || undefined
        : form.m3uUrl.trim() || undefined;

    const mergedEndpoints: CustomEndpointsConfig | undefined =
      effectiveType === 'custom_api'
        ? {
            ...(discovery?.suggestedEndpoints || {}),
            ...form.customEndpoints,
          }
        : undefined;

    return {
      id: form.id || `conn-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: form.name.trim() || 'Proveedor IPTV',
      type: effectiveType,
      preset: effectivePreset,
      communicationMode:
        effectiveType === 'custom_api' ? form.communicationMode : undefined,
      serverUrl: form.serverUrl.trim(),
      username: form.username.trim() || undefined,
      password: form.password || undefined,
      token: form.token.trim() || undefined,
      rememberSecretsInBrowser: form.rememberSecretsInBrowser,
      catalogId: form.catalogId.trim() || undefined,
      m3uUrl: effectiveM3uUrl,
      m3uRawContent: form.m3uRawContent || undefined,
      customEndpoints: mergedEndpoints,
      status: discovery
        ? discovery.overallStatus
        : testRes
        ? testRes.status
        : existing?.status || 'untested',
      statusMessage: discovery
        ? discovery.summaryMessage
        : testRes
        ? testRes.message
        : existing?.statusMessage,
      lastTestedAt: discovery || testRes ? now : existing?.lastTestedAt,
      lastDiscoveryReport: discovery || existing?.lastDiscoveryReport,
      capabilities: {
        auth:
          effectiveType === 'xtream' ||
          Boolean(
            mergedEndpoints?.loginIptvEndpoint?.trim() ||
              mergedEndpoints?.authEndpoint?.trim()
          ),
        account: effectiveType === 'xtream',
        liveTv: effectiveType === 'xtream' || effectiveType === 'm3u',
        movies: true,
        series: effectiveType !== 'm3u',
        details: effectiveType === 'xtream',
        seasonsAndEpisodes: effectiveType === 'xtream',
        playback: effectiveType === 'xtream' || effectiveType === 'm3u',
        ...(discovery?.suggestedCapabilities ||
          testRes?.capabilities ||
          existing?.capabilities ||
          {}),
      },
      accountInfo:
        discovery?.accountInfo || testRes?.accountInfo || existing?.accountInfo,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  };

  const validateFormForDiscovery = (): string | null => {
    if (!form.serverUrl.trim() && !form.m3uUrl.trim() && !form.m3uRawContent.trim()) {
      return 'Introduce la URL base del servidor o importa una lista M3U para detectar la API.';
    }
    return null;
  };

  const validateFormForSave = (): string | null => {
    if (!form.name.trim()) {
      return 'Ingresa un nombre para identificar al proveedor.';
    }
    const effective = resolveEffectiveType();
    if (effective === 'xtream') {
      if (!form.serverUrl.trim()) return 'Ingresa la URL base del servidor Xtream Codes.';
      if (!form.username.trim() || !form.password) {
        return 'Ingresa usuario y contraseña de tu cuenta Xtream Codes.';
      }
    } else if (effective === 'm3u') {
      if (!form.m3uUrl.trim() && !form.serverUrl.trim() && !form.m3uRawContent.trim()) {
        return 'Proporciona una URL M3U autorizada o importa un archivo .m3u/.m3u8.';
      }
    } else if (effective === 'custom_api') {
      if (!form.serverUrl.trim()) return 'Ingresa la URL base del servidor.';
      if (form.preset === 'netsky' && !form.catalogId.trim()) {
        return 'Para Netsky debes especificar el identificador de catálogo (catalogId).';
      }
    }
    return null;
  };

  const handleDetectApi = async () => {
    const err = validateFormForDiscovery();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setDraftTestResult(null);
    setDetectingApi(true);
    try {
      const report = await providerDiscoveryService.discover({
        connectionId: form.id,
        name: form.name.trim() || 'Proveedor IPTV',
        serverUrl: form.serverUrl.trim(),
        requestedType: form.inputType,
        communicationMode: form.communicationMode,
        username: form.username,
        password: form.password,
        token: form.token,
        catalogId: form.catalogId,
        m3uUrl: form.m3uUrl,
        m3uRawContent: form.m3uRawContent,
        customEndpoints: form.customEndpoints,
      });
      setDraftDiscoveryReport(report);

      // Aplicar tipo y rutas detectadas sin inventar credenciales
      setForm((prev) => ({
        ...prev,
        inputType:
          prev.inputType === 'auto' ? report.detectedType : prev.inputType,
        preset:
          prev.inputType === 'auto' ? report.detectedPreset : prev.preset,
        m3uUrl:
          report.detectedType === 'm3u' && !prev.m3uUrl && prev.serverUrl
            ? prev.serverUrl
            : prev.m3uUrl,
        customEndpoints: {
          ...prev.customEndpoints,
          ...report.suggestedEndpoints,
        },
      }));
      if (report.detectedType === 'custom_api') {
        setShowAdvancedEndpoints(true);
      }
    } finally {
      setDetectingApi(false);
    }
  };

  const handleTestDraft = async () => {
    const err = validateFormForSave();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setTestingDraft(true);
    setDraftTestResult(null);
    try {
      const tempConn = buildConnectionObject(null, draftDiscoveryReport);
      const result = await testProviderConnection(tempConn);
      setDraftTestResult(result);
    } finally {
      setTestingDraft(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validateFormForSave();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const conn = buildConnectionObject(draftTestResult, draftDiscoveryReport);
    onSaveConnection(conn);
    setFormOpen(false);
    setDraftTestResult(null);
    setDraftDiscoveryReport(null);
  };

  const handleTestSavedConnection = async (conn: IptvConnection) => {
    setTestingConnId(conn.id);
    try {
      const result = await testProviderConnection(conn);
      onSaveConnection({
        ...conn,
        status: result.status,
        statusMessage: result.details
          ? `${result.message} ${result.details}`
          : result.message,
        lastTestedAt: Date.now(),
        accountInfo: result.accountInfo || conn.accountInfo,
        capabilities: {
          ...conn.capabilities,
          ...(result.capabilities || {}),
        },
        updatedAt: Date.now(),
      });
    } finally {
      setTestingConnId(null);
    }
  };

  const handleM3uFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setForm((prev) => ({
        ...prev,
        inputType: 'm3u',
        preset: 'm3u_file',
        name: prev.name || file.name.replace(/\.(m3u8?|txt)$/i, ''),
        m3uRawContent: content,
      }));
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-8">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Plug className="h-6 w-6 text-violet-400" aria-hidden="true" />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">
              Mis conexiones IPTV
            </h1>
            <p className="text-xs text-zinc-400">
              Registra proveedores, ejecuta autodetección de API y administra cada
              adaptador de protocolo por separado.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => openNewForm('custom_generic')}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-95"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva conexión
        </button>
      </div>

      {/* Aviso de seguridad */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-200">
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-amber-100">
            Seguridad de credenciales, backend Express y almacenamiento local
          </p>
          <p className="mt-1 text-amber-200/90">
            LocalStorage conserva únicamente preferencias y conexiones no sensibles; nunca
            almacena device_token ni profile_token. Para proveedores con CORS estricto como
            Netsky, NEXUS usa su propio backend Express en Node.js con lista blanca de
            proveedores autorizados y sesiones temporales en memoria del servidor (sin
            base de datos ni proxies abiertos).
          </p>
        </div>
      </div>

      {/* Formulario de conexión + Autodetección */}
      {formOpen && (
        <section className="space-y-6 rounded-2xl border border-white/10 bg-[#11131B] p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
            <h2 className="font-display text-lg font-semibold text-white">
              {form.id ? `Editar conexión: ${form.name}` : 'Registrar o autodetectar proveedor'}
            </h2>

            {!form.id && (
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['custom_generic', 'Detección automática'],
                    ['xtream_standard', 'Xtream Codes'],
                    ['m3u_url', 'M3U URL / Archivo'],
                    ['netsky', 'Netsky'],
                    ['kaelus', 'Kaelus'],
                  ] as Array<[ProviderPreset, string]>
                ).map(([presetKey, label]) => (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => openNewForm(presetKey)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      form.preset === presetKey
                        ? 'bg-violet-600 text-white'
                        : 'border border-white/10 bg-[#0B0C10] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="conn-name"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Nombre del proveedor
                </label>
                <input
                  id="conn-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej. Netsky, Kaelus, Mi proveedor..."
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="conn-type"
                  className="block text-xs font-medium text-zinc-300"
                >
                  Tipo de conexión
                </label>
                <select
                  id="conn-type"
                  value={form.inputType}
                  onChange={(e) => {
                    const nextType = e.target.value as ConnectionInputType;
                    const nextPreset: ProviderPreset =
                      nextType === 'xtream'
                        ? 'xtream_standard'
                        : nextType === 'm3u'
                        ? 'm3u_url'
                        : form.preset === 'netsky' || form.preset === 'kaelus'
                        ? form.preset
                        : 'custom_generic';
                    setForm({ ...form, inputType: nextType, preset: nextPreset });
                    if (nextType === 'custom_api') setShowAdvancedEndpoints(true);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="auto">Automático (Autodetección de API)</option>
                  <option value="xtream">Xtream Codes</option>
                  <option value="m3u">M3U</option>
                  <option value="custom_api">API personalizada</option>
                </select>
              </div>
            </div>

            {/* URL base */}
            <div>
              <label
                htmlFor="conn-server-url"
                className="block text-xs font-medium text-zinc-300"
              >
                URL base {form.inputType === 'm3u' ? '(o enlace M3U)' : 'del servidor'}
              </label>
              <input
                id="conn-server-url"
                type="url"
                value={form.inputType === 'm3u' ? form.m3uUrl || form.serverUrl : form.serverUrl}
                onChange={(e) => {
                  const val = e.target.value;
                  if (form.inputType === 'm3u') {
                    setForm({ ...form, m3uUrl: val, serverUrl: val });
                  } else {
                    setForm({ ...form, serverUrl: val });
                  }
                }}
                placeholder="https://servidor-del-proveedor.com"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Importar archivo M3U si es M3U o Automático */}
            {(form.inputType === 'm3u' || form.inputType === 'auto') && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-[#0B0C10] px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-violet-500/40 hover:text-white">
                  <Upload className="h-4 w-4 text-violet-400" aria-hidden="true" />
                  Importar archivo .m3u / .m3u8
                  <input
                    type="file"
                    accept=".m3u,.m3u8,.txt"
                    onChange={handleM3uFileUpload}
                    className="sr-only"
                  />
                </label>
                {form.m3uRawContent && (
                  <span className="text-xs text-emerald-400 tabular-nums">
                    Archivo M3U listo ({Math.round(form.m3uRawContent.length / 1024)} KB)
                  </span>
                )}
              </div>
            )}

            {/* Usuario, Contraseña, Token, Identificador de catálogo */}
            {form.inputType !== 'm3u' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="conn-username"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Usuario
                    </label>
                    <input
                      id="conn-username"
                      type="text"
                      autoComplete="off"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="Usuario (cuando aplique)"
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="conn-password"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Contraseña
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        id="conn-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="Contraseña (cuando aplique)"
                        className="w-full rounded-lg border border-white/10 bg-[#0B0C10] py-2.5 pl-3.5 pr-10 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={
                          showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                        }
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="conn-token"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Token
                    </label>
                    <input
                      id="conn-token"
                      type="text"
                      autoComplete="off"
                      value={form.token}
                      onChange={(e) => setForm({ ...form, token: e.target.value })}
                      placeholder="Token Bearer o clave API (cuando corresponda)"
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="conn-catalog-id"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Identificador de catálogo (catalogId)
                    </label>
                    <input
                      id="conn-catalog-id"
                      type="text"
                      value={form.catalogId}
                      onChange={(e) => setForm({ ...form, catalogId: e.target.value })}
                      placeholder="UUID o ID de catálogo del proveedor"
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.rememberSecretsInBrowser}
                    onChange={(e) =>
                      setForm({ ...form, rememberSecretsInBrowser: e.target.checked })
                    }
                    className="h-4 w-4 rounded accent-violet-600"
                  />
                  Recordar contraseña/token en LocalStorage de este navegador (no cifrado;
                  si se desmarca, solo permanecen en memoria durante esta sesión)
                </label>
              </>
            )}

            {/* Endpoints personalizados */}
            {(form.inputType === 'custom_api' || form.inputType === 'auto') && (
              <div className="rounded-xl border border-white/10 bg-[#0B0C10] p-4">
                <button
                  type="button"
                  onClick={() => setShowAdvancedEndpoints((s) => !s)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <span className="text-sm font-semibold text-white">
                      Endpoints de API personalizada
                    </span>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Configura rutas por proveedor sin mezclar protocolos. Los campos
                      vacíos se mantienen como pendientes de configuración.
                    </p>
                  </div>
                  {showAdvancedEndpoints ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                  )}
                </button>

                {showAdvancedEndpoints && (
                  <div className="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
                    {/* Flujo de autenticación login-iptv y sesión de perfil (configurable, sin inventar rutas) */}
                    <div className="space-y-3 rounded-xl border border-violet-500/20 bg-[#11131B] p-4">
                      <div>
                        <p className="text-xs font-semibold text-violet-200">
                          Capa de comunicación, autenticación y sesión en memoria
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-400">
                          El backend Express de NEXUS intermedia solo proveedores autorizados
                          (como Netsky) manteniendo device_token y profile_token en RAM del
                          servidor. El CORS del backend aplica solo entre NEXUS y su frontend.
                        </p>
                      </div>

                      <div>
                        <label
                          htmlFor="conn-comm-mode"
                          className="block text-xs text-zinc-400"
                        >
                          Modo de comunicación
                        </label>
                        <select
                          id="conn-comm-mode"
                          value={form.communicationMode}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              communicationMode: e.target.value as CommunicationMode,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                        >
                          <option value="backend_secure">
                            Backend seguro Express de NEXUS (recomendado para Netsky / CORS)
                          </option>
                          <option value="direct_browser">
                            Directo desde navegador (requiere CORS permitido por proveedor)
                          </option>
                        </select>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-zinc-400">
                            Ruta login-iptv (pendiente si se desconoce)
                          </label>
                          <input
                            type="text"
                            value={form.customEndpoints.loginIptvEndpoint || ''}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                customEndpoints: {
                                  ...form.customEndpoints,
                                  loginIptvEndpoint: e.target.value,
                                },
                              })
                            }
                            placeholder="Pendiente de configurar (no inventar ruta)"
                            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-zinc-400">
                            Método login-iptv
                          </label>
                          <select
                            value={form.customEndpoints.loginIptvMethod || 'POST'}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                customEndpoints: {
                                  ...form.customEndpoints,
                                  loginIptvMethod: e.target.value as 'POST' | 'GET',
                                },
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                          >
                            <option value="POST">POST (JSON)</option>
                            <option value="GET">GET</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs text-zinc-400">
                            Endpoint de sesión de perfil (cuerpo {'{}'})
                          </label>
                          <input
                            type="text"
                            value={form.customEndpoints.profileSessionEndpoint || ''}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                customEndpoints: {
                                  ...form.customEndpoints,
                                  profileSessionEndpoint: e.target.value,
                                },
                              })
                            }
                            placeholder="/api/v1/profiles/{profileId}/session"
                            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-zinc-400">
                            Mecanismo de envío de token
                          </label>
                          <select
                            value={form.customEndpoints.tokenTransport || 'unconfirmed'}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                customEndpoints: {
                                  ...form.customEndpoints,
                                  tokenTransport: e.target.value as TokenTransportMechanism,
                                },
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                          >
                            <option value="unconfirmed">
                              Pendiente de confirmar (sin envío supuesto)
                            </option>
                            <option value="bearer_header">
                              Cabecera Authorization: Bearer {'{token}'}
                            </option>
                            <option value="custom_header">Cabecera personalizada</option>
                            <option value="query_param">Parámetro en URL (query)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs text-zinc-400">
                            Token usado en catálogos
                          </label>
                          <select
                            value={
                              form.customEndpoints.sessionTokenSource || 'profile_token'
                            }
                            onChange={(e) =>
                              setForm({
                                ...form,
                                customEndpoints: {
                                  ...form.customEndpoints,
                                  sessionTokenSource: e.target.value as
                                    | 'profile_token'
                                    | 'device_token',
                                },
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                          >
                            <option value="profile_token">
                              profile_token (sesión de perfil)
                            </option>
                            <option value="device_token">
                              device_token (dispositivo)
                            </option>
                          </select>
                        </div>

                        {form.customEndpoints.tokenTransport === 'query_param' && (
                          <div>
                            <label className="block text-xs text-zinc-400">
                              Nombre del parámetro URL
                            </label>
                            <input
                              type="text"
                              value={form.customEndpoints.tokenQueryParam || ''}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  customEndpoints: {
                                    ...form.customEndpoints,
                                    tokenQueryParam: e.target.value,
                                  },
                                })
                              }
                              placeholder="token"
                              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                        )}

                        {form.customEndpoints.tokenTransport === 'custom_header' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs text-zinc-400">
                                Cabecera
                              </label>
                              <input
                                type="text"
                                value={form.customEndpoints.authHeaderName || ''}
                                onChange={(e) =>
                                  setForm({
                                    ...form,
                                    customEndpoints: {
                                      ...form.customEndpoints,
                                      authHeaderName: e.target.value,
                                    },
                                  })
                                }
                                placeholder="Authorization"
                                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-zinc-400">
                                Prefijo
                              </label>
                              <input
                                type="text"
                                value={form.customEndpoints.tokenPrefix || ''}
                                onChange={(e) =>
                                  setForm({
                                    ...form,
                                    customEndpoints: {
                                      ...form.customEndpoints,
                                      tokenPrefix: e.target.value,
                                    },
                                  })
                                }
                                placeholder="Bearer"
                                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0C10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de cuenta
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.accountEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              accountEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="/api/player/catalog/{catalogId}/account"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de autenticación alternativo (opcional)
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.authEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              authEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="Pendiente de configurar"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de películas
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.moviesEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              moviesEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="/api/player/catalog/{catalogId}/items?type=movie"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de series
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.seriesEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              seriesEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="/api/player/catalog/{catalogId}/items?type=series"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de detalles
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.detailsEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              detailsEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="Pendiente de configurar"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de temporadas / episodios
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.episodesEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              episodesEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="Pendiente de configurar"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de reproducción
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.playbackEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              playbackEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="Pendiente de configurar"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400">
                        Endpoint de TV en vivo (opcional)
                      </label>
                      <input
                        type="text"
                        value={form.customEndpoints.liveEndpoint || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            customEndpoints: {
                              ...form.customEndpoints,
                              liveEndpoint: e.target.value,
                            },
                          })
                        }
                        placeholder="Opcional"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131B] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  </div>
                )}
              </div>
            )}

            {formError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {formError}
              </div>
            )}

            {draftTestResult && (
              <div
                className={`rounded-xl border p-4 text-xs ${
                  draftTestResult.success
                    ? draftTestResult.status === 'pending_config'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-100'
                }`}
              >
                <p className="text-sm font-semibold">{draftTestResult.message}</p>
                {draftTestResult.details && (
                  <p className="mt-1 leading-relaxed opacity-90">
                    {draftTestResult.details}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setDraftTestResult(null);
                  setDraftDiscoveryReport(null);
                  setFormError(null);
                }}
                className="rounded-lg border border-white/15 px-4 py-2.5 text-xs font-medium text-zinc-300 hover:bg-white/5"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleDetectApi}
                disabled={detectingApi}
                className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-600/20 px-4 py-2.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-600/30 disabled:opacity-50"
              >
                {detectingApi ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Radar className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Detectar API
              </button>

              <button
                type="button"
                onClick={handleTestDraft}
                disabled={testingDraft}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600/20 px-4 py-2.5 text-xs font-semibold text-blue-200 transition-colors hover:bg-blue-600/30 disabled:opacity-50"
              >
                {testingDraft && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                Probar conexión
              </button>

              <button
                type="submit"
                className="rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-opacity hover:opacity-95"
              >
                Guardar conexión
              </button>
            </div>
          </form>

          {/* Resultados de autodetección inline */}
          {draftDiscoveryReport && (
            <div className="border-t border-white/[0.08] pt-6">
              <DiscoveryResultsPanel
                report={draftDiscoveryReport}
                isTesting={detectingApi}
                onRetry={handleDetectApi}
              />
            </div>
          )}
        </section>
      )}

      {/* Lista de conexiones guardadas */}
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-white">
          Proveedores guardados ({connections.length})
        </h2>

        {connections.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-[#11131B] p-10 text-center">
            <Plug className="mx-auto h-9 w-9 text-zinc-500" aria-hidden="true" />
            <p className="mt-3 font-display text-base font-semibold text-white">
              Aún no hay conexiones registradas
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Usa "Nueva conexión" y el botón "Detectar API" para analizar automáticamente
              cualquier proveedor compatible.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {connections.map((conn) => {
              const isActive = conn.id === activeConnectionId;
              const badge = getStatusBadge(conn.status);
              const StatusIcon = badge.Icon;

              return (
                <div
                  key={conn.id}
                  className={`flex flex-col justify-between rounded-2xl border p-5 transition-colors ${
                    isActive
                      ? 'border-violet-500/50 bg-[#141622]'
                      : 'border-white/[0.08] bg-[#11131B]'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-display text-base font-semibold text-white">
                            {conn.name}
                          </h3>
                          {isActive && (
                            <span className="text-xs font-semibold text-violet-400">
                              · Activa
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-400">
                          {conn.type === 'xtream'
                            ? 'Xtream Codes API'
                            : conn.type === 'm3u'
                            ? 'Lista M3U'
                            : conn.preset === 'netsky'
                            ? 'API personalizada · Netsky'
                            : conn.preset === 'kaelus'
                            ? 'API personalizada · Kaelus'
                            : 'API personalizada'}
                        </p>
                      </div>

                      <div
                        className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${badge.classes}`}
                      >
                        <StatusIcon className="h-4 w-4" aria-hidden="true" />
                        <span>{badge.label}</span>
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-zinc-400">
                      <p className="truncate font-mono text-zinc-300">
                        {conn.m3uUrl ||
                          conn.serverUrl ||
                          (conn.m3uRawContent
                            ? 'Archivo M3U importado localmente'
                            : '—')}
                      </p>
                      {conn.catalogId && (
                        <p className="font-mono">
                          Catálogo ID:{' '}
                          <span className="text-zinc-200">{conn.catalogId}</span>
                        </p>
                      )}
                      {conn.accountInfo?.expDate && (
                        <p className="tabular-nums">
                          Expira: {conn.accountInfo.expDate}
                        </p>
                      )}
                      {conn.statusMessage && (
                        <p className="pt-1 leading-relaxed text-zinc-300">
                          {conn.statusMessage}
                        </p>
                      )}
                    </div>

                    {conn.type === 'custom_api' && (
                      <NetskySessionPanel
                        connection={conn}
                        onEditConnection={() => openEditForm(conn)}
                        onSessionActivated={() => {
                          if (onRefreshActiveCatalog) {
                            onRefreshActiveCatalog(conn.id);
                          }
                        }}
                        onSessionLoggedOut={() => {
                          if (onRefreshActiveCatalog) {
                            onRefreshActiveCatalog(conn.id);
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* Acciones */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => onActivateConnection(conn.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
                        >
                          <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Activar
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onOpenDiagnostics(conn.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/35 bg-blue-600/15 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-600/25"
                      >
                        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                        Diagnóstico
                      </button>

                      <button
                        type="button"
                        onClick={() => handleTestSavedConnection(conn)}
                        disabled={testingConnId === conn.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        {testingConnId === conn.id && (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        )}
                        Probar
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditForm(conn)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/10"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        Editar
                      </button>
                    </div>

                    {confirmDeleteId === conn.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteConnection(conn.id);
                            setConfirmDeleteId(null);
                          }}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(conn.id)}
                        aria-label={`Eliminar conexión ${conn.name}`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
