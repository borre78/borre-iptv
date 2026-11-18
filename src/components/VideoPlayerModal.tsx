import Hls from 'hls.js';
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  Copy,
  Check,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipForward,
  Volume2,
  VolumeX,
  Languages,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioTrackOption,
  EpisodeItem,
  PlayerSession,
  SubtitleTrackOption,
} from '../types/iptv';

interface VideoPlayerModalProps {
  session: PlayerSession;
  defaultVolume: number;
  autoPlayNextEpisode: boolean;
  onClose: () => void;
  onProgressUpdate: (positionSeconds: number, durationSeconds: number) => void;
  onPlayNextEpisode?: (nextEpisode: EpisodeItem) => void;
  onOpenConnections: () => void;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function VideoPlayerModal({
  session,
  defaultVolume,
  autoPlayNextEpisode,
  onClose,
  onProgressUpdate,
  onPlayNextEpisode,
  onOpenConnections,
}: VideoPlayerModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(defaultVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Pistas de audio y subtítulos
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackOption[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>('off');
  const [openTrackMenu, setOpenTrackMenu] = useState<'audio' | 'subtitles' | null>(null);

  const { item, episode, seriesSeasons, source, resumeFromSeconds } = session;

  // Calcular episodio siguiente si es serie
  const nextEpisode = useMemo<EpisodeItem | null>(() => {
    if (!episode || !seriesSeasons || seriesSeasons.length === 0) return null;
    const flat: EpisodeItem[] = [];
    for (const s of seriesSeasons) {
      for (const ep of s.episodes) {
        flat.push(ep);
      }
    }
    const idx = flat.findIndex((e) => e.id === episode.id);
    if (idx !== -1 && idx + 1 < flat.length) {
      return flat[idx + 1];
    }
    return null;
  }, [episode, seriesSeasons]);

  const scheduleHideControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
        setOpenTrackMenu(null);
      }
    }, 3200);
  }, []);

  // Guardar progreso periódico
  useEffect(() => {
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      if (item.type !== 'live' && video.currentTime > 2) {
        onProgressUpdate(video.currentTime, video.duration);
      }
    }, 4000);
    return () => window.clearInterval(interval);
  }, [item.type, onProgressUpdate]);

  const saveFinalProgress = useCallback(() => {
    const video = videoRef.current;
    if (
      video &&
      item.type !== 'live' &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime > 2
    ) {
      onProgressUpdate(video.currentTime, video.duration);
    }
  }, [item.type, onProgressUpdate]);

  // Inicializar HLS.js o HTML5 Video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || source.status !== 'ready' || !source.url) {
      setIsBuffering(false);
      return;
    }

    setPlaybackError(null);
    setIsBuffering(true);
    setAudioTracks([]);
    setSubtitleTracks([]);
    setSelectedAudioId('');
    setSelectedSubtitleId('off');

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const streamUrl = source.url;
    const isHlsSource =
      source.engine === 'hls' || /\.m3u8(\?|$)/i.test(streamUrl);

    let appliedResume = false;
    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      if (
        !appliedResume &&
        resumeFromSeconds &&
        resumeFromSeconds > 3 &&
        Number.isFinite(video.duration) &&
        resumeFromSeconds < video.duration - 5
      ) {
        video.currentTime = resumeFromSeconds;
        appliedResume = true;
      }

      // Leer pistas nativas HTML5 si existen
      const textTracks = video.textTracks;
      if (textTracks && textTracks.length > 0) {
        const nativeSubs: SubtitleTrackOption[] = [];
        for (let i = 0; i < textTracks.length; i++) {
          const track = textTracks[i];
          nativeSubs.push({
            id: `native-${i}`,
            label: track.label || track.language || `Subtítulo ${i + 1}`,
            language: track.language,
          });
        }
        if (nativeSubs.length > 0) {
          setSubtitleTracks(nativeSubs);
        }
      }

      video.volume = isMuted ? 0 : volume;
      video
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setIsPlaying(false);
        });
    };

    const handleCanPlay = () => setIsBuffering(false);
    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleEnded = () => {
      setIsPlaying(false);
      saveFinalProgress();
      if (autoPlayNextEpisode && nextEpisode && onPlayNextEpisode) {
        onPlayNextEpisode(nextEpisode);
      }
    };
    const handleNativeError = () => {
      setIsBuffering(false);
      const errCode = video.error?.code;
      let detail =
        'No se pudo reproducir el flujo de video. El formato, códec o política CORS del servidor impidió la decodificación.';
      if (errCode === 2) {
        detail =
          'Error de red al descargar el flujo de video. Verifica la conexión o posibles restricciones CORS del servidor.';
      } else if (errCode === 3) {
        detail =
          'Error de decodificación multimedia. El archivo contiene códecs de audio/video incompatibles con el navegador.';
      } else if (errCode === 4) {
        detail =
          'Fuente multimedia no compatible o inaccesible (HTTP 403/404, CORS o contenedor no soportado por HTML5).';
      }
      setPlaybackError(detail);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleNativeError);

    if (isHlsSource && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: item.type === 'live',
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        setIsBuffering(false);
        if (hls.audioTracks && hls.audioTracks.length > 0) {
          setAudioTracks(
            hls.audioTracks.map((t, i) => ({
              id: String(i),
              label: t.name || t.lang || `Audio ${i + 1}`,
              language: t.lang,
            }))
          );
          setSelectedAudioId(String(hls.audioTrack >= 0 ? hls.audioTrack : 0));
        }
        if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
          setSubtitleTracks(
            hls.subtitleTracks.map((s, i) => ({
              id: `hls-${i}`,
              label: s.name || s.lang || `Subtítulo ${i + 1}`,
              language: s.lang,
            }))
          );
        }
        if (data.levels.length > 0) {
          video.volume = isMuted ? 0 : volume;
          video.play().catch(() => setIsPlaying(false));
        }
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        setAudioTracks(
          hls.audioTracks.map((t, i) => ({
            id: String(i),
            label: t.name || t.lang || `Audio ${i + 1}`,
            language: t.lang,
          }))
        );
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        setSubtitleTracks(
          hls.subtitleTracks.map((s, i) => ({
            id: `hls-${i}`,
            label: s.name || s.lang || `Subtítulo ${i + 1}`,
            language: s.lang,
          }))
        );
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        setIsBuffering(false);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setPlaybackError(
            'Error de red o bloqueo CORS al cargar el manifiesto HLS (.m3u8). Asegúrate de que el servidor permita reproducción desde navegadores web.'
          );
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          setPlaybackError(
            'El flujo HLS encontró un error de decodificación multimedia incompatible con el navegador.'
          );
        } else {
          setPlaybackError(
            `Error fatal del motor HLS (${data.details || 'desconocido'}).`
          );
        }
      });
    } else if (isHlsSource && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari soporte nativo HLS
      video.src = streamUrl;
    } else {
      video.src = streamUrl;
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleNativeError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.status, source.url, source.engine, retryCount]);

  // Acciones del reproductor
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
      saveFinalProgress();
    }
    scheduleHideControls();
  }, [saveFinalProgress, scheduleHideControls]);

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration)) return;
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
      scheduleHideControls();
    },
    [scheduleHideControls]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    video.muted = nextMuted;
    if (!nextMuted && volume === 0) {
      setVolume(0.7);
      video.volume = 0.7;
    }
    scheduleHideControls();
  }, [isMuted, scheduleHideControls, volume]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Ignorar si fullscreen no está permitido
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Atajos de teclado / Smart TV
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        saveFinalProgress();
        onClose();
      } else if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(10);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saveFinalProgress, seekBy, toggleFullscreen, toggleMute, togglePlay]);

  const handleAudioChange = (trackId: string) => {
    setSelectedAudioId(trackId);
    if (hlsRef.current) {
      hlsRef.current.audioTrack = Number(trackId);
    }
    setOpenTrackMenu(null);
  };

  const handleSubtitleChange = (trackId: string) => {
    setSelectedSubtitleId(trackId);
    if (hlsRef.current) {
      if (trackId === 'off') {
        hlsRef.current.subtitleTrack = -1;
      } else if (trackId.startsWith('hls-')) {
        hlsRef.current.subtitleTrack = Number(trackId.replace('hls-', ''));
      }
    } else if (videoRef.current) {
      const tracks = videoRef.current.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = trackId === `native-${i}` ? 'showing' : 'disabled';
      }
    }
    setOpenTrackMenu(null);
  };

  const handleCopyUrl = async () => {
    if (!source.url) return;
    try {
      await navigator.clipboard.writeText(source.url);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Ignorar si clipboard no disponible
    }
  };

  const titleDisplay = episode
    ? `${item.name} · T${episode.seasonNumber} E${episode.episodeNumber}: ${episode.title}`
    : item.name;

  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={scheduleHideControls}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Reproductor: ${titleDisplay}`}
    >
      {/* Cabecera superior del reproductor */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 bg-gradient-to-b from-black/90 via-black/50 to-transparent px-5 py-4 transition-opacity duration-200 ${
          showControls || source.status !== 'ready' || playbackError
            ? 'opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => {
              saveFinalProgress();
              onClose();
            }}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Volver del reproductor"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-semibold text-white sm:text-lg">
              {titleDisplay}
            </h2>
            <p className="truncate text-xs text-zinc-400">
              {source.format ? `Formato: ${source.format}` : 'Flujo IPTV'}
              {item.type === 'live' ? ' · Transmisión en directo' : ''}
            </p>
          </div>
        </div>

        {nextEpisode && onPlayNextEpisode && (
          <button
            type="button"
            onClick={() => {
              saveFinalProgress();
              onPlayNextEpisode(nextEpisode);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 whitespace-nowrap shrink-0"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" />
            Siguiente episodio
          </button>
        )}
      </div>

      {/* Área de video o estado de error/pendiente */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {source.status === 'ready' && !playbackError ? (
          <>
            <video
              ref={videoRef}
              onClick={togglePlay}
              playsInline
              crossOrigin="anonymous"
              className="h-full w-full max-h-screen object-contain"
            />
            {isBuffering && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="flex flex-col items-center gap-2 rounded-xl bg-black/75 px-5 py-4">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-400" aria-hidden="true" />
                  <span className="text-xs font-medium text-zinc-200">
                    Cargando flujo multimedia...
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mx-4 max-w-xl rounded-2xl border border-white/10 bg-[#11131C] p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                <AlertTriangle className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-3">
                <h3 className="font-display text-lg font-semibold text-white">
                  {source.status === 'pending_endpoint'
                    ? 'Fuente de reproducción pendiente de configuración'
                    : source.status === 'incompatible_format'
                    ? 'Formato no compatible directamente en navegador'
                    : 'No se pudo reproducir el contenido'}
                </h3>

                <p className="text-sm leading-relaxed text-zinc-300">
                  {playbackError || source.message}
                </p>

                {source.missingEndpointDoc && (
                  <p className="rounded-lg border border-white/10 bg-black/40 p-3 text-xs leading-relaxed text-zinc-400">
                    {source.missingEndpointDoc}
                  </p>
                )}

                {source.url && (
                  <div className="space-y-1.5">
                    <span className="block text-xs text-zinc-400">URL detectada:</span>
                    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/50 px-3 py-2">
                      <code className="flex-1 truncate font-mono text-xs text-zinc-300">
                        {source.url}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyUrl}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-400 hover:bg-white/5"
                      >
                        {copiedUrl ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {copiedUrl ? 'Copiada' : 'Copiar'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  {playbackError && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlaybackError(null);
                        setRetryCount((c) => c + 1);
                      }}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                    >
                      Reintentar reproducción
                    </button>
                  )}

                  {source.status === 'pending_endpoint' && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenConnections();
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
                    >
                      <Settings2 className="h-4 w-4" aria-hidden="true" />
                      Configurar en Mis conexiones
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                  >
                    Cerrar reproductor
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Barra de controles inferiores */}
      {source.status === 'ready' && !playbackError && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-5 pb-5 pt-10 transition-opacity duration-200 ${
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {/* Barra de progreso (para VOD/Series) */}
          {item.type !== 'live' && (
            <div className="mb-3 flex items-center gap-3">
              <span className="w-14 text-right font-mono text-xs text-zinc-300 tabular-nums">
                {formatClock(currentTime)}
              </span>
              <input
                type="range"
                aria-label="Posición de reproducción"
                min={0}
                max={duration || 100}
                step={1}
                value={Math.min(currentTime, duration || 100)}
                onChange={(e) => {
                  const nextPos = Number(e.target.value);
                  if (videoRef.current) {
                    videoRef.current.currentTime = nextPos;
                    setCurrentTime(nextPos);
                  }
                }}
                style={{
                  background: `linear-gradient(to right, #8B5CF6 ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%)`,
                }}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-violet-500"
              />
              <span className="w-14 font-mono text-xs text-zinc-400 tabular-nums">
                {formatClock(duration)}
              </span>
            </div>
          )}

          {/* Controles principales */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-500"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="h-5 w-5 fill-current" aria-hidden="true" />
                )}
              </button>

              {item.type !== 'live' && (
                <>
                  <button
                    type="button"
                    onClick={() => seekBy(-10)}
                    aria-label="Retroceder 10 segundos"
                    className="inline-flex h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span className="tabular-nums">10s</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => seekBy(10)}
                    aria-label="Avanzar 10 segundos"
                    className="inline-flex h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                  >
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                    <span className="tabular-nums">10s</span>
                  </button>
                </>
              )}

              {/* Control de volumen */}
              <div className="flex items-center gap-2 pl-1">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
                <input
                  type="range"
                  aria-label="Control de volumen"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    setIsMuted(v === 0);
                    if (videoRef.current) {
                      videoRef.current.volume = v;
                      videoRef.current.muted = v === 0;
                    }
                  }}
                  className="hidden h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/20 accent-blue-500 sm:block"
                />
              </div>
            </div>

            {/* Pistas y Pantalla completa */}
            <div className="relative flex items-center gap-2">
              {audioTracks.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenTrackMenu(openTrackMenu === 'audio' ? null : 'audio')
                    }
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/20"
                  >
                    <Languages className="h-4 w-4" aria-hidden="true" />
                    <span>Audio</span>
                  </button>
                  {openTrackMenu === 'audio' && (
                    <div className="absolute bottom-12 right-0 w-48 rounded-xl border border-white/15 bg-[#12141D] p-1.5 shadow-xl">
                      {audioTracks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleAudioChange(t.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${
                            selectedAudioId === t.id
                              ? 'bg-violet-600/30 font-semibold text-white'
                              : 'text-zinc-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="truncate">{t.label}</span>
                          {selectedAudioId === t.id && (
                            <Check className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {subtitleTracks.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenTrackMenu(
                        openTrackMenu === 'subtitles' ? null : 'subtitles'
                      )
                    }
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/20"
                  >
                    <Captions className="h-4 w-4" aria-hidden="true" />
                    <span>Subtítulos</span>
                  </button>
                  {openTrackMenu === 'subtitles' && (
                    <div className="absolute bottom-12 right-0 w-48 rounded-xl border border-white/15 bg-[#12141D] p-1.5 shadow-xl">
                      <button
                        type="button"
                        onClick={() => handleSubtitleChange('off')}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${
                          selectedSubtitleId === 'off'
                            ? 'bg-violet-600/30 font-semibold text-white'
                            : 'text-zinc-300 hover:bg-white/5'
                        }`}
                      >
                        <span>Desactivados</span>
                        {selectedSubtitleId === 'off' && (
                          <Check className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
                        )}
                      </button>
                      {subtitleTracks.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSubtitleChange(s.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${
                            selectedSubtitleId === s.id
                              ? 'bg-violet-600/30 font-semibold text-white'
                              : 'text-zinc-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="truncate">{s.label}</span>
                          {selectedSubtitleId === s.id && (
                            <Check className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={
                  isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'
                }
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
