import { ANIME } from '@consumet/extensions';

const unity = new ANIME.AnimeUnity();

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
    const res = await unity.search(query);
    if (!res?.results || res.results.length === 0) return [];

    return res.results.map((item: any) => ({
      title: item.title,
      slug: item.id,
      thumbnailUrl: item.image || '',
      rating: item.rating ? String(item.rating) : undefined,
      type: item.subOrDub || 'sub',
      provider: 'consumet' as const,
    }));
  } catch (err: any) {
    console.warn('[Deno Engine] Consumet search error:', err.message);
    return [];
  }
}

export async function getConsumetEpisodes(animeSlug: string): Promise<ConsumetEpisodeItem[]> {
  try {
    const info = await unity.fetchAnimeInfo(animeSlug);
    if (!info?.episodes || info.episodes.length === 0) return [];

    return info.episodes.map((ep: any) => ({
      episodeNumber: typeof ep.number === 'number' ? ep.number : Number(ep.number) || 1,
      slug: ep.id,
      title: ep.title || `Episode ${ep.number}`,
    }));
  } catch (err: any) {
    console.warn('[Deno Engine] Consumet getEpisodes error:', err.message);
    return [];
  }
}

export async function getConsumetStreams(episodeSlug: string): Promise<ConsumetStreamData> {
  try {
    const stream = await unity.fetchEpisodeSources(episodeSlug);
    const sources: ConsumetStreamSource[] = [];

    if (stream?.sources && stream.sources.length > 0) {
      for (const s of stream.sources) {
        const q = (s.quality || 'HD').toLowerCase();
        const rank = q.includes('1080') ? 4 : q.includes('720') ? 3 : q.includes('480') ? 2 : 1;
        sources.push({
          server: `Consumet ${s.quality.toUpperCase()}`,
          quality: q.includes('1080') ? '1080p' : q.includes('720') ? '720p' : q.includes('480') ? '480p' : 'Auto HD',
          qualityRank: rank,
          provider: 'Consumet API',
          url: s.url,
          isIframe: false, // Direct HLS playlist -> Native HarvestArtPlayer
        });
      }
    }

    const downloadSources = stream?.download
      ? [
          {
            quality: '1080p',
            links: [{ host: 'Consumet Direct CDN', url: stream.download }],
          },
        ]
      : [];

    return {
      episodeNumber: 1,
      title: 'Consumet Stream',
      streamSources: sources,
      downloadSources,
    };
  } catch (err: any) {
    console.warn('[Deno Engine] Consumet getStreams error:', err.message);
    return {
      episodeNumber: 1,
      title: 'Consumet Stream',
      streamSources: [],
      downloadSources: [],
    };
  }
}
