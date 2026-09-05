import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.ts';
import { safeFetch } from '../services/httpClient.ts';

const SANKA_API_HOST = process.env.SANKA_API_HOST || 'https://www.sankavollerei.web.id';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getQualityRank(quality: string): number {
  if (quality.includes('4k') || quality.includes('4K')) return 5;
  if (quality.includes('1080') || quality.toLowerCase().includes('fullhd')) return 4;
  if (quality.includes('720') || quality.toLowerCase().includes('mp4hd')) return 3;
  if (quality.includes('480')) return 2;
  return 1;
}

export async function searchSamehadaku(query: string): Promise<SearchResult[]> {
  try {
    const url = `${SANKA_API_HOST}/anime/samehadaku/search?q=${encodeURIComponent(query)}`;
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!res.ok) return [];
    const json = await res.json();
    const list = json?.data?.animeList || json?.data || [];
    if (!Array.isArray(list)) return [];

    const results: SearchResult[] = [];
    for (const item of list) {
      const slug = item.animeId || item.slug;
      const title = item.title?.replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim();
      if (slug && title) {
        results.push({
          title,
          slug,
          thumbnailUrl: item.poster || item.image || '',
          rating: item.score || '',
          type: 'TV',
          provider: 'samehadaku',
        });
      }
    }

    return results;
  } catch (err) {
    console.error('[Samehadaku Search Error]:', err);
    return [];
  }
}

export async function getSamehadakuEpisodes(animeSlug: string): Promise<EpisodeItem[]> {
  try {
    const cleanSlug = animeSlug.replace(/^anime\//, '').replace(/\/$/, '');
    const url = `${SANKA_API_HOST}/anime/samehadaku/anime/${cleanSlug}`;
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!res.ok) return [];
    const json = await res.json();
    const epList = json?.data?.episodeList || json?.episodeList || [];
    if (!Array.isArray(epList)) return [];

    const episodes: EpisodeItem[] = epList.map((ep: any, index: number) => {
      const titleStr = String(ep.title || ep.name || ep.episodeId || '');
      const idStr = String(ep.episodeId || ep.slug || '');
      const numMatch =
        titleStr.match(/episode\s*(\d+)/i) ||
        idStr.match(/episode-(\d+)/i) ||
        titleStr.match(/(\d+)/);
      const episodeNumber = numMatch ? parseInt(numMatch[1], 10) : index + 1;
      return {
        episodeNumber,
        slug: idStr || `ep-${index + 1}`,
        title: titleStr || `Episode ${episodeNumber}`,
      };
    });

    // Sort ascending (1, 2, 3...)
    return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  } catch (err) {
    console.error('[Samehadaku Episodes Error]:', err);
    return [];
  }
}

export async function getSamehadakuStreams(episodeSlug: string): Promise<EpisodeStreams> {
  try {
    const cleanSlug = episodeSlug.replace(/^episode\//, '').replace(/\/$/, '');
    const url = `${SANKA_API_HOST}/anime/samehadaku/episode/${cleanSlug}`;
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return {
        episodeNumber: 1,
        title: 'Episode Stream',
        streamSources: [],
        downloadSources: [],
      };
    }

    const json = await res.json();
    const epData = json?.data;
    const numMatch = cleanSlug.match(/episode-(\d+)/i) || cleanSlug.match(/(\d+)$/);
    const epNumber = numMatch ? parseInt(numMatch[1], 10) : 1;

    const streamSources: StreamSource[] = [];

    // 1. Resolve server qualities (Wibufile, Blogspot, Mega, Filedon) in parallel
    const serverTasks: Promise<void>[] = [];
    const qualities = epData?.server?.qualities || [];
    for (const q of qualities) {
      const qTitle = q.title || '720p';
      const rank = getQualityRank(qTitle);
      for (const s of q.serverList || []) {
        if (s.serverId) {
          serverTasks.push(
            (async () => {
              try {
                const sRes = await safeFetch(
                  `${SANKA_API_HOST}/anime/samehadaku/server/${s.serverId}`,
                  {
                    headers: {
                      'User-Agent': USER_AGENT,
                      Accept: 'application/json',
                    },
                  }
                );
                if (sRes.ok) {
                  const sJson = await sRes.json();
                  const mediaUrl = sJson?.data?.url;
                  if (mediaUrl && mediaUrl.startsWith('http')) {
                    streamSources.push({
                      server: `Samehadaku ${s.title} (${qTitle})`,
                      quality: qTitle,
                      qualityRank: rank,
                      provider: 'samehadaku',
                      url: mediaUrl,
                      isIframe: !mediaUrl.endsWith('.mp4'),
                    });
                  }
                }
              } catch (_) {}
            })()
          );
        }
      }
    }

    // Wait up to 3500ms for parallel server resolution
    if (serverTasks.length > 0) {
      await Promise.race([
        Promise.all(serverTasks),
        new Promise((r) => setTimeout(r, 3500)),
      ]);
    }

    // 2. Parse downloadUrl.formats (MP4, MKV, x265 with Pixeldrain, Gofile, Filedon, etc.)
    const downloadSources: DownloadSource[] = [];
    const formats = epData?.downloadUrl?.formats || [];
    for (const fmt of formats) {
      for (const q of fmt.qualities || []) {
        const qTitle = q.title?.trim() || '720p';
        const links = (q.urls || [])
          .map((u: any) => ({
            host: u.title?.trim() || 'Direct',
            url: u.url,
          }))
          .filter((u: any) => u.url);

        if (links.length > 0) {
          downloadSources.push({
            quality: `MP4 ${qTitle}`,
            links,
          });
        }
      }
    }

    // Sort streams highest resolution first (1080p -> 720p -> 480p)
    streamSources.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

    return {
      episodeNumber: epNumber,
      title: epData?.title || `Episode ${epNumber}`,
      streamSources,
      downloadSources,
    };
  } catch (err) {
    console.error('[Samehadaku Streams Error]:', err);
    return {
      episodeNumber: 1,
      title: 'Episode Stream',
      streamSources: [],
      downloadSources: [],
    };
  }
}
