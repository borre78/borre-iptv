import {
  CheckCircle2,
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { customApiAdapter } from '../services/adapters';
import { shouldUseSecureBackend } from '../services/backendClient';
import { subscribeNetskySessions } from '../services/netskySessionService';
import { IptvConnection, NetskySafeSessionView } from '../types/iptv';

interface NetskySessionPanelProps {
  connection: IptvConnection;
  onSessionActivated?: () => void;
  onSessionLoggedOut?: () => void;
  onEditConnection?: () => void;
}

export function NetskySessionPanel({
  connection,
  onSessionActivated,
  onSessionLoggedOut,
  onEditConnection,
}: NetskySessionPanelProps) {
  const usesBackend = shouldUseSecureBackend(connection);
  const [session, setSession] = useState<NetskySafeSessionView>(() =>
    customApiAdapter.getSessionState(connection.id)
  );
  const [busyAction, setBusyAction] = useState<
    'login' | 'profile' | 'renew' | null
  >(null);

  useEffect(() => {
    setSession(customApiAdapter.getSessionState(connection.id));
    if (usesBackend) {
      void customApiAdapter.syncSessionState(connection);
    }
    return subscribeNetskySessions(() => {
      setSession(customApiAdapter.getSessionState(connection.id));
    });
  }, [connection, usesBackend]);

  const handleLogin = async () => {
    setBusyAction('login');
    try {
      const next = await customApiAdapter.loginIptv(connection);
      setSession(next);
      if (next.status === 'session_active' && onSessionActivated) {
        onSessionActivated();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleSelectProfile = async (profileId: string) => {
    setBusyAction('profile');
    try {
      const next = await customApiAdapter.selectProfileAndCreateSession(
        connection,
        profileId
      );
      setSession(next);
      if (next.status === 'session_active' && onSessionActivated) {
        onSessionActivated();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleRenew = async () => {
    setBusyAction('renew');
    try {
      const next = await customApiAdapter.renewProfileSession(connection);
      setSession(next);
      if (next.status === 'session_active' && onSessionActivated) {
        onSessionActivated();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = () => {
    const cleared = customApiAdapter.logout(connection.id);
    setSession(cleared);
    if (onSessionLoggedOut) {
      onSessionLoggedOut();
    }
  };

  const ep = connection.customEndpoints || {};
  const loginConfigured = Boolean(
    ep.loginIptvEndpoint?.trim() || ep.authEndpoint?.trim()
  );
  const transportConfigured =
    Boolean(ep.tokenTransport) && ep.tokenTransport !== 'unconfirmed';

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-white/[0.08] bg-[#0B0C10] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-violet-400" aria-hidden="true" />
          <span className="text-xs font-semibold text-white">
            Sesión en memoria y perfiles
          </span>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
            session.status === 'session_active'
              ? 'text-emerald-400'
              : session.status === 'device_authenticated'
              ? 'text-blue-400'
              : session.status === 'expired' || session.status === 'error'
              ? 'text-rose-400'
              : 'text-zinc-400'
          }`}
        >
          {session.status === 'session_active' ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Sesión activa ({session.selectedProfileName || 'Perfil'})
            </>
          ) : session.status === 'device_authenticated' ? (
            <>
              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Dispositivo autenticado · Elige perfil
            </>
          ) : session.status === 'expired' ? (
            <>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Sesión expirada
            </>
          ) : (
            <>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Sin sesión iniciada
            </>
          )}
        </span>
      </div>

      {/* Estado de configuración de ruta login-iptv y mecanismo de envío */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span>
          Ruta login-iptv:{' '}
          <strong className={loginConfigured ? 'text-zinc-200' : 'text-amber-300'}>
            {loginConfigured
              ? ep.loginIptvEndpoint || ep.authEndpoint
              : 'Pendiente de configurar'}
          </strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Envío de token:{' '}
          <strong className={transportConfigured ? 'text-zinc-200' : 'text-amber-300'}>
            {transportConfigured ? ep.tokenTransport : 'Pendiente de confirmar'}
          </strong>
        </span>
      </div>

      {session.statusMessage && (
        <p className="text-xs leading-relaxed text-zinc-300">
          {session.statusMessage}
        </p>
      )}

      {/* Resumen de cuenta sanitizado (sin tokens) */}
      {session.accountSummary && (
        <div className="rounded-lg border border-white/[0.06] bg-[#11131B] px-3 py-2 text-xs text-zinc-300">
          <span className="font-medium text-zinc-400">Cuenta: </span>
          {Object.entries(session.accountSummary)
            .slice(0, 4)
            .map(([k, v], i) => (
              <span key={k}>
                {i > 0 && ' · '}
                <span className="text-zinc-400">{k}:</span> {String(v)}
              </span>
            ))}
        </div>
      )}

      {/* Lista de perfiles disponibles tras login-iptv */}
      {session.profiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">
            Perfiles disponibles (POST /api/v1/profiles/{'{profileId}'}/session):
          </p>
          <div className="flex flex-wrap gap-2">
            {session.profiles.map((profile) => {
              const isSelected = session.selectedProfileId === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => handleSelectProfile(profile.id)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    isSelected
                      ? 'border-violet-500/60 bg-violet-600/25 text-white'
                      : 'border-white/10 bg-[#141622] text-zinc-300 hover:border-violet-500/40 hover:text-white'
                  }`}
                >
                  <UserCheck className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
                  <span>{profile.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Expiración segura sin mostrar tokens */}
      {(session.hasDeviceToken || session.hasProfileToken) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 tabular-nums">
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {usesBackend
              ? 'Tokens protegidos solo en memoria del servidor Express (no enviados al navegador ni LocalStorage)'
              : 'Tokens protegidos solo en memoria (no guardados en LocalStorage)'}
          </span>
          {session.profileTokenExpiresAt && (
            <span>
              · Expira:{' '}
              {new Date(session.profileTokenExpiresAt).toLocaleTimeString('es-ES')}
            </span>
          )}
        </div>
      )}

      {/* Acciones de sesión */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleLogin}
          disabled={busyAction !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/25 px-3 py-1.5 text-xs font-semibold text-violet-200 ring-1 ring-violet-500/40 transition-colors hover:bg-violet-600/35 disabled:opacity-50"
        >
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
          {busyAction === 'login' ? 'Autenticando...' : 'Iniciar sesión (login-iptv)'}
        </button>

        {session.hasDeviceToken && session.selectedProfileId && (
          <button
            type="button"
            onClick={handleRenew}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-600/15 px-3 py-1.5 text-xs font-medium text-blue-200 hover:bg-blue-600/25 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${busyAction === 'renew' ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Renovar sesión
          </button>
        )}

        {(session.hasDeviceToken || session.hasProfileToken || session.profiles.length > 0) && (
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Cerrar sesión
          </button>
        )}

        {(!loginConfigured || !transportConfigured) && onEditConnection && (
          <button
            type="button"
            onClick={onEditConnection}
            className="text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            Configurar rutas y envío de token
          </button>
        )}
      </div>
    </div>
  );
}
