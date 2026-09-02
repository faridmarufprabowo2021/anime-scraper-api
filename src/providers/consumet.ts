import * as cheerio from 'cheerio';
import { safeFetch } from '../services/httpClient.ts';

const BASE_URL = 'https://www.animeunity.to';

export interface ConsumetSearchResult {
  title: string;
  slug: string;
  thumbnailUrl: string;
  rating?: string;
  type: string;
  provider: 'consumet';
}

export interface ConsumetEpisodeItem {
  episodeNumber: number;
  slug: string;
  title: string;
}

export interface ConsumetStreamSource {
  server: string;
  quality: string;
  qualityRank: number;
  provider: string;
  url: string;
  isIframe: boolean;
}

export interface ConsumetStreamData {
  episodeNumber: number;
  title: string;
  streamSources: ConsumetStreamSource[];
  downloadSources: { quality: string; links: { host: string; url: string }[] }[];
}

export async function searchConsumet(query: string): Promise<ConsumetSearchResult[]> {
  try {
    const url = `${BASE_URL}/archivio?title=${encodeURIComponent(query)}`;
    const res = await safeFetch(url);
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const recordsAttr = $('archivio').attr('records');
    if (!recordsAttr) return [];

    const items = JSON.parse(recordsAttr);
    const results: ConsumetSearchResult[] = [];

    for (const item of items) {
      results.push({
        title: item.title || item.title_eng,
        slug: `${item.id}-${item.slug}`,
        thumbnailUrl: item.imageurl || '',
        rating: item.score ? String(item.score) : undefined,
        type: item.dub ? 'DUB' : 'SUB',
        provider: 'consumet',
      });
    }

    return results;
  } catch (err: any) {
    console.warn('[Consumet Provider] Search error:', err.message);
    return [];
  }
}

export async function getConsumetEpisodes(animeSlug: string): Promise<ConsumetEpisodeItem[]> {
  try {
    const animeId = animeSlug.split('-')[0];
    const url = `${BASE_URL}/info_api/${animeId}/1?start_range=1&end_range=120`;
    const res = await safeFetch(url);
    if (!res.ok) return [];

    const json = await res.json();
    const episodes = json?.episodes || [];

    return episodes.map((ep: any) => ({
      episodeNumber: typeof ep.number === 'number' ? ep.number : Number(ep.number) || 1,
      slug: `${animeSlug}/${ep.id}`,
      title: `Episode ${ep.number}`,
    }));
  } catch (err: any) {
    console.warn('[Consumet Provider] getEpisodes error:', err.message);
    return [];
  }
}

export async function getConsumetStreams(episodeSlug: string): Promise<ConsumetStreamData> {
  try {
    const url = `${BASE_URL}/anime/${episodeSlug}`;
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);
    const embedUrl = $('video-player').attr('embed_url');
    if (!embedUrl) throw new Error('No embed_url found');

    const embedRes = await safeFetch(embedUrl);
    if (!embedRes.ok) throw new Error(`Embed HTTP ${embedRes.status}`);

    const embedHtml = await embedRes.text();
    const domainMatch = embedHtml.match(/url:\s*['"]([^'"]+)['"]/);
    const tokenMatch = embedHtml.match(/token['"]?:\s*['"]([^'"]+)['"]/);
    const expiresMatch = embedHtml.match(/expires['"]?:\s*['"]([^'"]+)['"]/);

    const sources: ConsumetStreamSource[] = [];

    if (domainMatch && tokenMatch && expiresMatch) {
      const domain = domainMatch[1];
      const token = tokenMatch[1];
      const expires = expiresMatch[1];
      const defaultUrl = `${domain}${domain.includes('?') ? '&' : '?'}token=${token}&referer=&expires=${expires}&h=1`;

      try {
        const m3u8Res = await safeFetch(defaultUrl);
        if (m3u8Res.ok) {
          const m3u8Text = await m3u8Res.text();
          if (m3u8Text.includes('EXTM3U')) {
            const lines = m3u8Text.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line.startsWith('#EXT-X-STREAM-INF:') && line.includes('RESOLUTION=')) {
                const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
                const streamUrl = lines[i + 1]?.trim();
                if (resMatch && streamUrl && streamUrl.startsWith('http')) {
                  const height = resMatch[1];
                  const rank = height === '1080' ? 4 : height === '720' ? 3 : height === '480' ? 2 : 1;
                  sources.push({
                    server: `Consumet ${height}P`,
                    quality: `${height}p`,
                    qualityRank: rank,
                    provider: 'Consumet API',
                    url: streamUrl,
                    isIframe: false,
                  });
                }
              }
            }
          }
        }
      } catch (m3u8Err) {
        console.warn('[Consumet Provider] m3u8 parse error:', m3u8Err);
      }

      sources.push({
        server: 'Consumet Auto HD',
        quality: 'Auto HD',
        qualityRank: 1,
        provider: 'Consumet API',
        url: defaultUrl,
        isIframe: false,
      });
    }

    const dlMatch = embedHtml.match(/downloadUrl\s*=\s*['"]([^'"]+)['"]/);
    const downloadSources = dlMatch
      ? [
          {
            quality: '1080p',
            links: [{ host: 'Consumet Direct CDN', url: dlMatch[1] }],
          },
        ]
      : [];

    // Sort streams highest resolution first
    sources.sort((a, b) => (b.qualityRank ?? 1) - (a.qualityRank ?? 1));

    return {
      episodeNumber: 1,
      title: 'Consumet Stream',
      streamSources: sources,
      downloadSources,
    };
  } catch (err: any) {
    console.warn('[Consumet Provider] getStreams error:', err.message);
    return {
      episodeNumber: 1,
      title: 'Consumet Stream',
      streamSources: [],
      downloadSources: [],
    };
  }
}
