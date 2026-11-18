export interface NetworkDiagnostic {
  kind: 'cors' | 'auth' | 'not_found' | 'server' | 'parse' | 'mixed_content' | 'network';
  title: string;
  message: string;
  tips: string[];
  corsDetected: boolean;
}

export function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isMixedContentRisk(targetUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.protocol === 'https:' &&
    targetUrl.trim().toLowerCase().startsWith('http://')
  );
}

export function diagnoseHttpStatus(status: number, targetUrl: string): NetworkDiagnostic {
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      title: `Acceso denegado (HTTP ${status})`,
      message:
        'El servidor rechazó las credenciales, el token de acceso o los permisos de la cuenta para este recurso.',
      tips: [
        'Verifica que el usuario, contraseña, token o catalogId correspondan a una suscripción activa.',
        'Comprueba si el proveedor restringe las peticiones desde navegadores web.',
      ],
      corsDetected: false,
    };
  }

  if (status === 404) {
    return {
      kind: 'not_found',
      title: 'Endpoint o recurso no encontrado (HTTP 404)',
      message: `La ruta solicitada no existe en el servidor (${targetUrl}).`,
      tips: [
        'Revisa la URL base del servidor y el identificador de catálogo.',
        'En APIs personalizadas, confirma que la ruta del endpoint coincida con la documentación del proveedor.',
      ],
      corsDetected: false,
    };
  }

  return {
    kind: 'server',
    title: `Error del servidor (HTTP ${status})`,
    message: `El servidor respondió con código de estado ${status}.`,
    tips: [
      'Intenta nuevamente en unos segundos; el servidor del proveedor podría estar saturado o en mantenimiento.',
    ],
    corsDetected: false,
  };
}

export function diagnoseFetchError(error: unknown, targetUrl: string): NetworkDiagnostic {
  if (isMixedContentRisk(targetUrl)) {
    return {
      kind: 'mixed_content',
      title: 'Bloqueo de contenido mixto (HTTPS vs HTTP)',
      message:
        'La aplicación se ejecuta bajo HTTPS, pero el servidor IPTV usa HTTP sin cifrado. Los navegadores bloquean peticiones HTTP inseguras desde páginas HTTPS.',
      tips: [
        'Utiliza la URL HTTPS del proveedor si está disponible.',
        'Las aplicaciones web no deben evadir políticas de seguridad del navegador ni usar proxies no autorizados.',
      ],
      corsDetected: false,
    };
  }

  const messageText = error instanceof Error ? error.message : String(error);
  const isLikelyCorsOrNetwork =
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|cors|access-control/i.test(messageText);

  if (isLikelyCorsOrNetwork) {
    return {
      kind: 'cors',
      title: 'Bloqueo CORS o error de red en navegador',
      message:
        'El navegador no pudo leer la respuesta del servidor. Esto ocurre habitualmente cuando el servidor IPTV no envía la cabecera Access-Control-Allow-Origin para permitir peticiones directas desde aplicaciones web, o cuando el dominio no responde.',
      tips: [
        'CORS es una política de seguridad del navegador: el servidor del proveedor debe autorizar explícitamente este origen.',
        'NEXUS IPTV no utiliza proxies para eludir restricciones ni autorizaciones del proveedor.',
        'Verifica también que la URL del servidor sea accesible y no tenga errores de certificado SSL.',
      ],
      corsDetected: true,
    };
  }

  return {
    kind: 'network',
    title: 'Error de comunicación con el servidor',
    message: messageText || 'No se pudo completar la solicitud al proveedor.',
    tips: [
      'Revisa tu conexión a internet y confirma que el servidor IPTV esté en línea.',
    ],
    corsDetected: false,
  };
}
