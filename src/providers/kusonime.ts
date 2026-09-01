import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.ts';
import { safeFetch } from '../services/httpClient.ts';

const KUSONIME_HOST = process.env.KUSONIME_HOST || 'https://kusonime.com';

function getQualityRank(quality: string): number {
  if (quality.includes('1080')) return 4;
  if (quality.includes('720')) return 3;
  if (quality.includes('480')) return 2;
  return 1;
}


export async function searchKusonime(query: string): Promise<SearchResult[]> {
  return await searchKusonimeInternal(query);
}

export async function getKusonimeStreams(slug: string): Promise<EpisodeStreams> {
  const res = await getKusonimeStreamsInternal(slug);
  return {
    episodeNumber: res.episodeNumber,
    title: res.title,
    streamSources: res.streamSources,
    downloadSources: res.downloadSources,
  };
}
