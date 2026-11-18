import {
  CatalogCategory,
  CatalogItem,
  ConnectionTestResult,
  EpisodeItem,
  IptvConnection,
  MediaType,
  MovieDetails,
  PlaybackSourceResolution,
  SeriesDetails,
} from '../../types/iptv';
import { analyzeMediaFormat, extractExtensionFromUrlOrField } from '../../utils/mediaFormats';
import {
  diagnoseFetchError,
  diagnoseHttpStatus,
  isValidHttpUrl,
} from '../../utils/networkErrors';
import { ProviderAdapter } from './types';

interface ParsedM3UEntry {
  id: string;
  name: string;
  group: string;
  logo?: string;
  tvgId?: string;
  url: string;
  inferredType: MediaType;
  extension?: string;
}

function parseExtInfAttributes(attrLine: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrLine)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

function inferMediaType(group: string, url: string, name: string): MediaType {
  const lowerUrl = url.toLowerCase();
  const lowerGroup = group.toLowerCase();
  const lowerName = name.toLowerCase();

  if (
    /\/series\//i.test(lowerUrl) ||
    /\b(s\d{1,2}e\d{1,2}|temporada|episodio|series)\b/i.test(lowerGroup) ||
    /\bS\d{1,2}\s*E\d{1,2}\b/i.test(lowerName)
  ) {
    return 'series';
  }

  if (
    /\/movie\//i.test(lowerUrl) ||
    /\/vod\//i.test(lowerUrl) ||
    /\b(pel[ií]cula|peliculas|movies|vod|cine|cinema|estrenos)\b/i.test(lowerGroup) ||
    /\.(mp4|mkv|avi|webm|mov)(\?|$)/i.test(lowerUrl)
  ) {
    return 'movie';
  }

  return 'live';
}

export function parseM3UPlaylist(rawText: string): ParsedM3UEntry[] {
  const lines = rawText.split(/\r?\n/);
  const entries: ParsedM3UEntry[] = [];

  let pendingMeta: {
    name: string;
    group: string;
    logo?: string;
    tvgId?: string;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',');
      const metaPart = commaIdx !== -1 ? line.slice(8, commaIdx) : line.slice(8);
      const titlePart = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : '';
      const attrs = parseExtInfAttributes(metaPart);

      const group = attrs['group-title']?.trim() || 'Sin categoría';
      const name = titlePart || attrs['tvg-name']?.trim() || `Canal ${entries.length + 1}`;
      pendingMeta = {
        name,
        group,
        logo: attrs['tvg-logo']?.trim() || undefined,
        tvgId: attrs['tvg-id']?.trim() || undefined,
      };
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      const grp = line.slice(8).trim();
      if (pendingMeta && grp) {
        pendingMeta.group = grp;
      }
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      const meta = pendingMeta || {
        name: `Flujo ${entries.length + 1}`,
        group: 'Sin categoría',
      };
      const inferredType = inferMediaType(meta.group, line, meta.name);
      const ext = extractExtensionFromUrlOrField(undefined, line);
      entries.push({
        id: meta.tvgId || `m3u-${entries.length + 1}`,
        name: meta.name,
        group: meta.group,
        logo: meta.logo,
        tvgId: meta.tvgId,
        url: line,
        inferredType,
        extension: ext || undefined,
      });
      pendingMeta = null;
    }
  }

  return entries;
}

async function getRawM3UContent(connection: IptvConnection): Promise<string> {
  if (connection.m3uRawContent && connection.m3uRawContent.trim()) {
    return connection.m3uRawContent;
  }

  const targetUrl = (connection.m3uUrl || connection.serverUrl || '').trim();
  if (!targetUrl || !isValidHttpUrl(targetUrl)) {
    throw new Error('Debes proporcionar una URL M3U válida o importar un archivo .m3u/.m3u8.');
  }

  let res: Response;
  try {
    res = await fetch(targetUrl, { method: 'GET' });
  } catch (err) {
    const diag = diagnoseFetchError(err, targetUrl);
    throw new Error(`${diag.title}: ${diag.message}`);
  }

  if (!res.ok) {
    const diag = diagnoseHttpStatus(res.status, targetUrl);
    throw new Error(`${diag.title}: ${diag.message}`);
  }

  return await res.text();
}

function toCatalogItems(
  entries: ParsedM3UEntry[],
  connectionId: string,
  filterType: MediaType
): CatalogItem[] {
  return entries
    .filter((e) => e.inferredType === filterType)
    .map((e, idx) => ({
      id: `${filterType}-${idx}-${e.id}`,
      connectionId,
      type: filterType,
      name: e.name,
      categoryId: e.group,
      categoryName: e.group,
      logo: e.logo,
      streamUrl: e.url,
      containerExtension: e.extension,
      year: e.name.match(/\((\d{4})\)/)?.[1],
      channelNumber: filterType === 'live' ? idx + 1 : undefined,
    }));
}

function buildCategories(items: CatalogItem[], type: MediaType): CatalogCategory[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const cat = item.categoryId || 'Sin categoría';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, count]) => ({
    id: name,
    name,
    type,
    count,
  }));
}

export const m3uAdapter: ProviderAdapter = {
  id: 'm3u',

  async testConnection(connection: IptvConnection): Promise<ConnectionTestResult> {
    if (connection.m3uRawContent && connection.m3uRawContent.trim()) {
      const entries = parseM3UPlaylist(connection.m3uRawContent);
      if (entries.length === 0) {
        return {
          success: false,
          status: 'network_error',
          message: 'El archivo o texto M3U importado no contiene enlaces de streaming válidos.',
        };
      }
      const liveCount = entries.filter((e) => e.inferredType === 'live').length;
      const movieCount = entries.filter((e) => e.inferredType === 'movie').length;
      const seriesCount = entries.filter((e) => e.inferredType === 'series').length;
      return {
        success: true,
        status: 'connected',
        message: `Lista M3U local analizada (${entries.length} elementos).`,
        details: `TV en vivo: ${liveCount} · Películas: ${movieCount} · Series: ${seriesCount}.`,
        sampleItemsCount: entries.length,
        capabilities: {
          auth: false,
          liveTv: liveCount > 0,
          movies: movieCount > 0,
          series: seriesCount > 0,
          details: false,
          seasonsAndEpisodes: false,
          playback: true,
        },
      };
    }

    const targetUrl = (connection.m3uUrl || connection.serverUrl || '').trim();
    if (!targetUrl || !isValidHttpUrl(targetUrl)) {
      return {
        success: false,
        status: 'network_error',
        message: 'Introduce una URL M3U válida (http:// o https://) o importa un archivo local.',
      };
    }

    try {
      const text = await getRawM3UContent(connection);
      const entries = parseM3UPlaylist(text);
      if (entries.length === 0) {
        return {
          success: false,
          status: 'network_error',
          message:
            'El servidor respondió, pero no se encontraron entradas #EXTINF / URLs válidas en la lista M3U.',
        };
      }
      const liveCount = entries.filter((e) => e.inferredType === 'live').length;
      const movieCount = entries.filter((e) => e.inferredType === 'movie').length;
      const seriesCount = entries.filter((e) => e.inferredType === 'series').length;

      return {
        success: true,
        status: 'connected',
        message: `Lista M3U cargada (${entries.length} elementos detectados).`,
        details: `TV en vivo: ${liveCount} · Películas: ${movieCount} · Series: ${seriesCount}. La disponibilidad real de reproducción depende de CORS y formato de cada stream.`,
        sampleItemsCount: entries.length,
        capabilities: {
          auth: false,
          liveTv: liveCount > 0,
          movies: movieCount > 0,
          series: seriesCount > 0,
          details: false,
          seasonsAndEpisodes: false,
          playback: true,
        },
      };
    } catch (err) {
      const diag = diagnoseFetchError(err, targetUrl);
      return {
        success: false,
        status: diag.corsDetected ? 'cors_error' : 'network_error',
        message: err instanceof Error ? err.message : diag.title,
        details: diag.tips.join(' '),
        corsDetected: diag.corsDetected,
      };
    }
  },

  async getMovieCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    const items = await this.getMovies(connection);
    return buildCategories(items, 'movie');
  },

  async getMovies(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const raw = await getRawM3UContent(connection);
    const items = toCatalogItems(parseM3UPlaylist(raw), connection.id, 'movie');
    if (categoryId && categoryId !== 'all') {
      return items.filter((i) => i.categoryId === categoryId);
    }
    return items;
  },

  async getSeriesCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    const items = await this.getSeries(connection);
    return buildCategories(items, 'series');
  },

  async getSeries(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const raw = await getRawM3UContent(connection);
    const items = toCatalogItems(parseM3UPlaylist(raw), connection.id, 'series');
    if (categoryId && categoryId !== 'all') {
      return items.filter((i) => i.categoryId === categoryId);
    }
    return items;
  },

  async getLiveCategories(connection: IptvConnection): Promise<CatalogCategory[]> {
    const items = await this.getLiveStreams(connection);
    return buildCategories(items, 'live');
  },

  async getLiveStreams(connection: IptvConnection, categoryId?: string): Promise<CatalogItem[]> {
    const raw = await getRawM3UContent(connection);
    const items = toCatalogItems(parseM3UPlaylist(raw), connection.id, 'live');
    if (categoryId && categoryId !== 'all') {
      return items.filter((i) => i.categoryId === categoryId);
    }
    return items;
  },

  async getMovieDetails(_connection: IptvConnection, item: CatalogItem): Promise<MovieDetails> {
    return {
      item,
      backdrop: item.logo,
      releaseDate: item.year,
      containerExtension: item.containerExtension,
      missingDetailsNotice:
        'Las listas M3U solo incluyen nombre, grupo, logotipo y enlace directo; no proveen sinopsis ni reparto.',
    };
  },

  async getSeriesDetails(_connection: IptvConnection, item: CatalogItem): Promise<SeriesDetails> {
    const singleEpisode: EpisodeItem | null = item.streamUrl
      ? {
          id: item.id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: item.name,
          streamUrl: item.streamUrl,
          containerExtension: item.containerExtension,
          thumbnail: item.logo,
        }
      : null;

    return {
      item,
      backdrop: item.logo,
      seasons: singleEpisode
        ? [{ seasonNumber: 1, name: 'Enlace M3U directo', episodes: [singleEpisode] }]
        : [],
    };
  },

  async resolvePlaybackSource(
    _connection: IptvConnection,
    item: CatalogItem,
    episode?: EpisodeItem
  ): Promise<PlaybackSourceResolution> {
    const url = episode?.streamUrl || item.streamUrl;
    if (!url) {
      return {
        status: 'error',
        browserCompatible: false,
        message: 'La entrada M3U no contiene una URL de stream válida.',
      };
    }

    const format = analyzeMediaFormat(
      episode?.containerExtension || item.containerExtension,
      url
    );

    if (!format.browserCompatible) {
      return {
        status: 'incompatible_format',
        url,
        format: format.label,
        engine: format.engine,
        browserCompatible: false,
        message: `${format.reason || ''} ${format.recommendation || ''}`.trim(),
      };
    }

    return {
      status: 'ready',
      url,
      format: format.label,
      engine: format.engine,
      browserCompatible: true,
    };
  },
};

export class M3UProviderAdapter implements ProviderAdapter {
  readonly id = 'm3u';
  testConnection = m3uAdapter.testConnection.bind(m3uAdapter);
  getMovieCategories = m3uAdapter.getMovieCategories.bind(m3uAdapter);
  getMovies = m3uAdapter.getMovies.bind(m3uAdapter);
  getSeriesCategories = m3uAdapter.getSeriesCategories.bind(m3uAdapter);
  getSeries = m3uAdapter.getSeries.bind(m3uAdapter);
  getLiveCategories = m3uAdapter.getLiveCategories.bind(m3uAdapter);
  getLiveStreams = m3uAdapter.getLiveStreams.bind(m3uAdapter);
  getMovieDetails = m3uAdapter.getMovieDetails.bind(m3uAdapter);
  getSeriesDetails = m3uAdapter.getSeriesDetails.bind(m3uAdapter);
  resolvePlaybackSource = m3uAdapter.resolvePlaybackSource.bind(m3uAdapter);
}

