import { safeFetch } from '../services/httpClient.ts';
import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.ts';

const SANKA_HOST = 'https://www.sankavollerei.web.id';

export async function searchWinbu(query: string): Promise<SearchResult[]> {
  try {
    const res = await safeFetch(`${SANKA_HOST}/anime/winbu/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.results || []).map((it: any) => ({
      title: it.title,
      slug: it.id || it.slug,
      thumbnailUrl: it.image || it.poster || '',
      provider: 'winbu',
    }));
  } catch {
    return [];
  }
}

export async function getWinbuEpisodes(slug: string): Promise<EpisodeItem[]> {
  try {
    const res = await safeFetch(`${SANKA_HOST}/anime/winbu/anime/${slug}`);
    if (!res.ok) return [];
    const json = await res.json();
    const rawEps = json?.data?.episodes || [];
    return rawEps.map((ep: any, i: number) => {
      let epNum = i + 1;
      const numM = (ep.title || '').match(/Episode\s*(\d+)/i);
      if (numM) epNum = parseInt(numM[1], 10);
      return {
        episodeNumber: epNum,
        slug: ep.id || ep.slug,
        title: ep.title || `Episode ${epNum}`,
      };
    });
  } catch {
    return [];
  }
}

export async function getWinbuStreams(epSlug: string): Promise<EpisodeStreams> {
  try {
    const res = await safeFetch(`${SANKA_HOST}/anime/winbu/episode/${epSlug}`);
    if (!res.ok) return { episodeNumber: 1, title: 'Episode', streamSources: [] };
    const json = await res.json();
    const streamSources: StreamSource[] = [];
    const downloadSources: DownloadSource[] = [];

    const rawDl = json?.data?.downloads || [];
    for (const dl of rawDl) {
      const qual = dl.resolution || '720p';
      const links = (dl.links || []).map((l: any) => ({ host: l.server || 'Download', url: l.url }));
      if (links.length > 0) {
        downloadSources.push({ quality: `MP4 ${qual}`, links });
        for (const l of links) {
          if (l.host.toLowerCase().includes('mega') && l.url.includes('mega.nz/file/')) {
            streamSources.push({
              server: `Mega ${qual.toUpperCase()}`,
              quality: qual.toLowerCase().includes('1080') ? '1080p' : '720p',
              qualityRank: qual.toLowerCase().includes('1080') ? 4 : 3,
              provider: 'winbu',
              url: l.url.replace('mega.nz/file/', 'mega.nz/embed/'),
              isIframe: true,
            });
          }
        }
      }
    }

    return {
      episodeNumber: 1,
      title: json?.data?.title || 'Episode',
      streamSources,
      downloadSources,
    };
  } catch {
    return { episodeNumber: 1, title: 'Episode', streamSources: [] };
  }
}