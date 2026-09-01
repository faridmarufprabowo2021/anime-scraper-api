import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.ts';
import { safeFetch } from '../services/httpClient.ts';

const SANKA_API_HOST = process.env.SANKA_API_HOST || 'https://www.sankavollerei.web.id';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class SankaWinbuAdapter implements AnimeProviderAdapter {
  name = 'sanka_winbu' as const;

  async search(query: string): Promise<ProviderSearchResult[]> {
    try {
      const url = `${SANKA_API_HOST}/anime/winbu/search?q=${encodeURIComponent(query)}`;
      const res = await safeFetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!res.ok) return [];
      const json = await res.json();
      const results = json?.results || [];
      if (!Array.isArray(results)) return [];

      const searchResults: ProviderSearchResult[] = [];
      for (const item of results) {
        const slug = item.id || item.slug;
        const title = item.title || '';
        if (slug && title) {
          searchResults.push({
            title,
            slug,
            thumbnailUrl: item.image || item.poster || '',
            rating: item.rating || '',
            type: 'TV',
            provider: 'sanka_winbu' as const,
          });
        }
      }

      return searchResults;
    } catch (err) {
      console.error('[Sanka Winbu Search Error]:', err);
      return [];
    }
  }

  async getEpisodes(animeSlug: string): Promise<ProviderEpisodeItem[]> {
    try {
      const url = `${SANKA_API_HOST}/anime/winbu/anime/${animeSlug}`;
      const res = await safeFetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!res.ok) return [];
      const json = await res.json();
      const rawEps = json?.data?.episodes || [];
      if (!Array.isArray(rawEps)) return [];

      const episodes: ProviderEpisodeItem[] = [];
      for (const ep of rawEps) {
        const epSlug = ep.id || ep.slug;
        let epNum = 0;
        if (ep.title) {
          const numMatch = ep.title.match(/Episode\s*(\d+)/i) || ep.title.match(/(\d+)/);
          if (numMatch) epNum = parseInt(numMatch[1], 10);
        }

        if (epSlug) {
          episodes.push({
            episodeNumber: epNum || 1,
            slug: epSlug,
            title: ep.title || `Episode ${epNum || 1}`,
          });
        }
      }

      // Sort episodes ascending (1, 2, 3...)
      return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    } catch (err) {
      console.error('[Sanka Winbu Episodes Error]:', err);
      return [];
    }
  }

  async getEpisodeStreams(episodeSlug: string): Promise<ProviderEpisodeStreamData> {
    try {
      const url = `${SANKA_API_HOST}/anime/winbu/episode/${episodeSlug}`;
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
        };
      }

      const json = await res.json();
      const rawServers = json?.data?.servers || [];
      const streamSources: ProviderStreamSource[] = [];

      let epNumber = 1;
      const numMatch = episodeSlug.match(/episode-(\d+)/i);
      if (numMatch) epNumber = parseInt(numMatch[1], 10);

      const serverTasks: Promise<void>[] = [];

      for (const s of rawServers) {
        const resLabel = (s.resolution || '720p').toLowerCase();
        const serverName = (s.server || 'Server').toUpperCase();
        const postData = s.data;

        if (postData && postData.post && postData.nume) {
          serverTasks.push(
            (async () => {
              try {
                const sUrl = `${SANKA_API_HOST}/anime/winbu/server?post=${encodeURIComponent(postData.post)}&nume=${encodeURIComponent(postData.nume)}&type=${encodeURIComponent(postData.type || 'schtml')}`;
                const sRes = await safeFetch(sUrl, {
                  headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'application/json',
                  },
                });

                if (sRes.ok) {
                  const sJson = await sRes.json();
                  const embedUrl = sJson?.embed_url;
                  if (embedUrl && typeof embedUrl === 'string' && embedUrl.startsWith('http')) {
                    let rank = 3;
                    if (resLabel.includes('1080')) rank = 4;
                    else if (resLabel.includes('720')) rank = 3;
                    else if (resLabel.includes('480')) rank = 2;
                    else if (resLabel.includes('360')) rank = 1;

                    streamSources.push({
                      server: `Winbu ${serverName} (${resLabel.toUpperCase()})`,
                      quality: resLabel.toUpperCase(),
                      qualityRank: rank,
                      provider: 'sanka_winbu',
                      url: embedUrl,
                      isIframe: true,
                    });
                  }
                }
              } catch (_) {}
            })()
          );
        }
      }

      // Wait up to 3500ms for server resolution
      if (serverTasks.length > 0) {
        await Promise.race([
          Promise.all(serverTasks),
          new Promise((r) => setTimeout(r, 3500)),
        ]);
      }

      // Extract direct 1080p, 720p, 480p download links (Mega, Acefile, Gofile)
      const downloadSources: { quality: string; links: { host: string; url: string }[] }[] = [];
      const rawDownloads = json?.data?.downloads || [];
      if (Array.isArray(rawDownloads)) {
        for (const dl of rawDownloads) {
          const qual = dl.resolution || '720p';
          const links = (dl.links || [])
            .map((l: any) => ({
              host: l.server || 'Download',
              url: l.url,
            }))
            .filter((l: any) => l.url);
          if (links.length > 0) {
            downloadSources.push({ quality: `MP4 ${qual}`, links });
          }
        }
      }

      // Sort by Quality (1080p -> 720p -> 480p)
      streamSources.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

      return {
        episodeNumber: epNumber,
        title: json?.data?.title || `Episode ${epNumber}`,
        streamSources,
        downloadSources,
      };
    } catch (err) {
      console.error('[Sanka Winbu Stream Error]:', err);
      return {
        episodeNumber: 1,
        title: 'Episode Stream',
        streamSources: [],
      };
    }
  }
}

export const sankaWinbu = new SankaWinbuAdapter();


export async function searchWinbu(query: string): Promise<SearchResult[]> {
  const adapter = new SankaWinbuAdapter();
  return (await adapter.search(query)).map(r => ({
    title: r.title,
    slug: r.slug,
    thumbnailUrl: r.thumbnailUrl,
    rating: r.rating,
    type: r.type,
    provider: 'winbu',
  }));
}

export async function getWinbuEpisodes(slug: string): Promise<EpisodeItem[]> {
  const adapter = new SankaWinbuAdapter();
  return await adapter.getEpisodes(slug);
}

export async function getWinbuStreams(slug: string): Promise<EpisodeStreams> {
  const adapter = new SankaWinbuAdapter();
  const res = await adapter.getEpisodeStreams(slug);
  return {
    episodeNumber: res.episodeNumber,
    title: res.title,
    streamSources: res.streamSources,
    downloadSources: res.downloadSources,
  };
}