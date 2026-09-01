import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.ts';
import { safeFetch } from '../services/httpClient.ts';

const OTAKUDESU_HOST = process.env.OTAKUDESU_HOST || 'https://otakudesu.blog';

function getQualityRank(quality: string): number {
  if (quality.includes('1080')) return 4;
  if (quality.includes('720')) return 3;
  if (quality.includes('480')) return 2;
  return 1;
}


export async function searchOtakudesu(query: string): Promise<SearchResult[]> {
  const adapter = new OtakudesuAdapter();
  return (await adapter.search(query)).map(r => ({
    title: r.title,
    slug: r.slug,
    thumbnailUrl: r.thumbnailUrl,
    rating: r.rating,
    type: r.type,
    provider: 'otakudesu',
  }));
}

export async function getOtakudesuEpisodes(slug: string): Promise<EpisodeItem[]> {
  const adapter = new OtakudesuAdapter();
  return await adapter.getEpisodes(slug);
}

export async function getOtakudesuStreams(slug: string): Promise<EpisodeStreams> {
  const adapter = new OtakudesuAdapter();
  const res = await adapter.getEpisodeStreams(slug);
  return {
    episodeNumber: res.episodeNumber,
    title: res.title,
    streamSources: res.streamSources,
    downloadSources: res.downloadSources,
  };
}

export class OtakudesuAdapter {
  name = 'otakudesu';
  search = searchOtakudesuInternal;
  getEpisodes = getOtakudesuEpisodesInternal;
  getEpisodeStreams = getOtakudesuStreamsInternal;
}
