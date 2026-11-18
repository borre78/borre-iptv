export interface MediaFormatAnalysis {
  extension: string;
  engine: 'hls' | 'html5' | 'unsupported';
  browserCompatible: boolean;
  label: string;
  reason?: string;
  recommendation?: string;
}

const HLS_EXTENSIONS = new Set(['m3u8']);
const HTML5_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mp3', 'aac']);
const UNSUPPORTED_IN_BROWSER = new Set([
  'mkv',
  'avi',
  'wmv',
  'flv',
  'divx',
  'vob',
  'iso',
  'mpg',
  'mpeg',
  '3gp',
  'asf',
  'rmvb',
]);

export function extractExtensionFromUrlOrField(
  containerExtension?: string,
  url?: string
): string {
  if (containerExtension && containerExtension.trim()) {
    return containerExtension.trim().toLowerCase().replace(/^\./, '');
  }
  if (!url) return '';

  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const lastSegment = cleanUrl.split('/').pop() || '';
    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex !== -1 && dotIndex < lastSegment.length - 1) {
      return lastSegment.slice(dotIndex + 1).toLowerCase();
    }
  } catch {
    // Ignorar URLs malformadas
  }
  return '';
}

export function analyzeMediaFormat(
  containerExtension?: string,
  url?: string
): MediaFormatAnalysis {
  const ext = extractExtensionFromUrlOrField(containerExtension, url);

  if (url && /\.m3u8(\?|$)/i.test(url)) {
    return {
      extension: 'm3u8',
      engine: 'hls',
      browserCompatible: true,
      label: 'HLS (m3u8)',
    };
  }

  if (HLS_EXTENSIONS.has(ext)) {
    return {
      extension: 'm3u8',
      engine: 'hls',
      browserCompatible: true,
      label: 'HLS (m3u8)',
    };
  }

  if (HTML5_EXTENSIONS.has(ext)) {
    return {
      extension: ext,
      engine: 'html5',
      browserCompatible: true,
      label: ext.toUpperCase(),
    };
  }

  if (ext === 'mov') {
    return {
      extension: 'mov',
      engine: 'html5',
      browserCompatible: true,
      label: 'MOV (compatibilidad parcial)',
      reason:
        'Algunos archivos MOV usan códecs (como HEVC o audio AC3) que dependen del soporte de cada navegador.',
    };
  }

  if (ext === 'ts') {
    return {
      extension: 'ts',
      engine: 'unsupported',
      browserCompatible: false,
      label: 'MPEG-TS sin manifiesto HLS',
      reason:
        'Los flujos MPEG-TS directos (.ts) no son reproducibles directamente mediante la etiqueta HTML5 <video> del navegador.',
      recommendation:
        'Configura el proveedor para entregar el canal en formato HLS (.m3u8) compatible con HLS.js.',
    };
  }

  if (UNSUPPORTED_IN_BROWSER.has(ext)) {
    return {
      extension: ext,
      engine: 'unsupported',
      browserCompatible: false,
      label: ext.toUpperCase(),
      reason: `El contenedor ${ext.toUpperCase()} no es compatible de forma nativa con los navegadores web HTML5 (especialmente en códecs de audio AC3/DTS/EAC3 o pistas empaquetadas).`,
      recommendation:
        'El servidor del proveedor debe entregar una fuente alternativa en HLS (.m3u8) o MP4 (H.264/AAC), o habilitar un endpoint de reproducción web compatible.',
    };
  }

  // Si no tiene extensión explícita en la URL (por ejemplo rutas dinámicas de streaming),
  // se intentará HLS si contiene pistas hls/manifest o HTML5 con aviso transparente.
  if (url && /hls|playlist|manifest/i.test(url)) {
    return {
      extension: 'm3u8',
      engine: 'hls',
      browserCompatible: true,
      label: 'Flujo HLS detectado',
    };
  }

  return {
    extension: ext || 'desconocido',
    engine: 'html5',
    browserCompatible: true,
    label: ext ? ext.toUpperCase() : 'Flujo directo',
    reason: !ext
      ? 'La URL no especifica extensión de contenedor. El navegador intentará decodificarlo directamente y reportará si el formato no es compatible.'
      : undefined,
  };
}
