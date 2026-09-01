import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.ts';
import { safeFetch } from '../services/httpClient.ts';

const KUSONIME_HOST = process.env.KUSONIME_HOST || 'https://kusonime.com';

function getQualityRank(quality: string): number {
  if (quality.includes('1080')) return 4;
  if (quality.includes('720')) return 3;
  if (quality.includes('480')) return 2;
  return 1;
}

export class KusonimeAdapter implements AnimeProviderAdapter {
  name = 'kusonime' as const;

  async search(query: string): Promise<ProviderSearchResult[]> {
    try {
      const url = `${KUSONIME_HOST}/?s=${encodeURIComponent(query)}&post_type=anime`;
      const res = await safeFetch(url);
      if (!res.ok) return [];
      const html = await res.text();

      const results: ProviderSearchResult[] = [];
      const itemRegex = /<h2 class=['"]episodeye['"]><a href=['"]https?:\/\/[^\/]+\/([^"'\/]+)\/?['"] title=['"]([^'"]+)['"]/gi;
      let match;

      while ((match = itemRegex.exec(html)) !== null) {
        const slug = match[1];
        const rawTitle = match[2].replace(/Subtitle Indonesia/i, '').replace(/BD/i, '').trim();

        if (slug && !results.some((r) => r.slug === slug)) {
          results.push({
            title: rawTitle,
            slug,
            type: 'Movie',
            provider: 'kusonime' as const,
          });
        }
      }

      return results;
    } catch (err) {
      console.warn(`Kusonime search failed for "${query}":`, err);
      return [];
    }
  }

  async getEpisodes(animeSlug: string): Promise<ProviderEpisodeItem[]> {
    const cleanSlug = animeSlug.replace(/\/$/, '');
    return [
      {
        episodeNumber: 1,
        slug: cleanSlug,
        title: 'Full Movie / Batch',
      },
    ];
  }

  async getEpisodeStreams(episodeSlug: string): Promise<ProviderEpisodeStreamData> {
    try {
      const cleanSlug = episodeSlug.replace(/\/$/, '');
      const url = `${KUSONIME_HOST}/${cleanSlug}/`;
      const res = await safeFetch(url);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const html = await res.text();

      const streamSources: ProviderStreamSource[] = [];
      const downloadSources: { quality: string; links: { host: string; url: string }[] }[] = [];

      // Parse each specific resolution block (1080P, 720P, 480P, 360P)
      const pRegex = /<strong>([^<]*?(?:360|480|720|1080)[^<]*?)<\/strong>([\s\S]*?)(?=<strong>|<\/div>|<div class=["']smokeddl)/gi;
      let pMatch;

      while ((pMatch = pRegex.exec(html)) !== null) {
        const qualityHeader = pMatch[1].trim().toUpperCase();
        let exactQuality = '720p';
        if (qualityHeader.includes('1080')) exactQuality = '1080p';
        else if (qualityHeader.includes('720')) exactQuality = '720p';
        else if (qualityHeader.includes('480')) exactQuality = '480p';
        else if (qualityHeader.includes('360')) exactQuality = '360p';

        const qRank = getQualityRank(exactQuality);
        const linksSnippet = pMatch[2];
        const linkRegex = /href=['"]([^'"]+)['"][^>]*>([^<]+)<\/a>/gi;
        let lm;

        const currentDlLinks: { host: string; url: string }[] = [];

        while ((lm = linkRegex.exec(linksSnippet)) !== null) {
          const rawUrl = lm[1].replace(/&amp;/g, '&');
          const hostName = lm[2].trim();
          currentDlLinks.push({ host: hostName, url: rawUrl });

          // 1. Google Drive preview for EXACT resolution (Top Priority)
          if (rawUrl.includes('drive.google.com')) {
            const fileId = rawUrl.match(/[?&]id=([a-zA-Z0-9_\-]+)/)?.[1] || rawUrl.match(/\/d\/([a-zA-Z0-9_\-]+)/)?.[1];
            if (fileId) {
              const embedUrl = `https://drive.google.com/file/d/${fileId}/preview`;
              streamSources.push({
                server: `Google Drive ${exactQuality.toUpperCase()} (Full Stream)`,
                quality: exactQuality,
                qualityRank: qRank,
                provider: `GDrive (${exactQuality})`,
                url: embedUrl,
                isIframe: true,
              });
            }
          }

          // 2. Acefile player for EXACT resolution
          if (rawUrl.includes('acefile.co/f/')) {
            const embedUrl = rawUrl.replace('/f/', '/player/');
            streamSources.push({
              server: `AceFile ${exactQuality.toUpperCase()} (FastCDN)`,
              quality: exactQuality,
              qualityRank: qRank,
              provider: `AceFile (${exactQuality})`,
              url: embedUrl,
              isIframe: true,
            });
          }

          // 3. Mega embed
          if (rawUrl.includes('mega.nz/file/')) {
            const embedUrl = rawUrl.replace('mega.nz/file/', 'mega.nz/embed/');
            streamSources.push({
              server: `Mega ${exactQuality.toUpperCase()}`,
              quality: exactQuality,
              qualityRank: qRank,
              provider: `Mega (${exactQuality})`,
              url: embedUrl,
              isIframe: true,
            });
          }

          // 3. PixelDrain stream
          if (rawUrl.includes('pixeldrain.com/u/') || rawUrl.includes('pixeldrain.com/l/')) {
            const id = rawUrl.match(/(?:u|l)\/([a-zA-Z0-9]+)/)?.[1];
            if (id) {
              streamSources.push({
                server: `PixelDrain Stream ${exactQuality.toUpperCase()}`,
                quality: exactQuality,
                qualityRank: qRank,
                provider: `PixelDrain (${exactQuality})`,
                url: `https://pixeldrain.com/u/${id}`,
                isIframe: true,
              });
            }
          }

          // 4. TeraBox embed
          if (rawUrl.includes('terabox') && rawUrl.includes('/s/')) {
            const surl = rawUrl.match(/\/s\/([a-zA-Z0-9_\-]+)/)?.[1];
            if (surl) {
              streamSources.push({
                server: `TeraBox Cloud ${exactQuality.toUpperCase()}`,
                quality: exactQuality,
                qualityRank: qRank,
                provider: `TeraBox (${exactQuality})`,
                url: `https://www.terabox.com/sharing/embed?surl=${surl}`,
                isIframe: true,
              });
            }
          }

          // 5. Mega.nz embed for EXACT resolution (Backup)
          if (rawUrl.includes('mega.nz/file/')) {
            const embedUrl = rawUrl.replace('/file/', '/embed/');
            streamSources.push({
              server: `Mega Cloud ${exactQuality.toUpperCase()} (Backup)`,
              quality: exactQuality,
              qualityRank: qRank,
              provider: `Mega (${exactQuality})`,
              url: embedUrl,
              isIframe: true,
            });
          }
        }

        if (currentDlLinks.length > 0) {
          downloadSources.push({
            quality: exactQuality,
            links: currentDlLinks,
          });
        }
      }

      // Sort streams strictly by quality (1080p first, then 720p, then 480p, then 360p)
      streamSources.sort((a, b) => (b.qualityRank ?? 1) - (a.qualityRank ?? 1));

      // Title extraction
      const titleMatch = html.match(/<h1 class=['"]jdlmean['"]>([^<]+)<\/h1>/i) ||
                         html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/Subtitle Indonesia/i, '').trim() : 'Full Movie';

      return {
        episodeNumber: 1,
        title,
        activeProvider: 'Kusonime HD Engine',
        streamSources,
        downloadSources,
      };
    } catch (err) {
      console.warn(`Kusonime getEpisodeStreams failed for "${episodeSlug}":`, err);
      return {
        episodeNumber: 1,
        title: 'Episode 1',
        streamSources: [],
      };
    }
  }
}

export const kusonime = new KusonimeAdapter();


export async function searchKusonime(query: string): Promise<SearchResult[]> {
  const adapter = new KusonimeAdapter();
  return (await adapter.search(query)).map(r => ({
    title: r.title,
    slug: r.slug,
    thumbnailUrl: r.thumbnailUrl,
    rating: r.rating,
    type: r.type,
    provider: 'kusonime',
  }));
}

export async function getKusonimeStreams(slug: string): Promise<EpisodeStreams> {
  const adapter = new KusonimeAdapter();
  const res = await adapter.getEpisodeStreams(slug);
  return {
    episodeNumber: res.episodeNumber,
    title: res.title,
    streamSources: res.streamSources,
    downloadSources: res.downloadSources,
  };
}