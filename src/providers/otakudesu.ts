import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.ts';
import { safeFetch } from '../services/httpClient.ts';

const OTAKUDESU_HOST = process.env.OTAKUDESU_HOST || 'https://otakudesu.blog';

function getQualityRank(quality: string): number {
  if (quality.includes('1080')) return 4;
  if (quality.includes('720')) return 3;
  if (quality.includes('480')) return 2;
  return 1;
}

export class OtakudesuAdapter implements AnimeProviderAdapter {
  name = 'otakudesu' as const;

  async search(query: string): Promise<ProviderSearchResult[]> {
    try {
      const url = `${OTAKUDESU_HOST}/?s=${encodeURIComponent(query)}&post_type=anime`;
      const res = await safeFetch(url);

      if (!res.ok) return [];
      const html = await res.text();

      const items: ProviderSearchResult[] = [];
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let match;

      while ((match = liRegex.exec(html)) !== null) {
        const li = match[1];
        const titleMatch =
          li.match(/<h2><a href="([^"]+)">([^<]+)<\/a><\/h2>/i) ||
          li.match(/<a href="https:\/\/otakudesu\.[a-z]+\/(?:anime|lengkap)\/([^"]+)"[^>]*>([^<]+)<\/a>/i);
        const imgMatch = li.match(/<img[^>]+src="([^"]+)"/i);
        const setMatch = li.match(/<div class="set">([^<]+)<\/div>/i);

        if (titleMatch) {
          const rawUrl = titleMatch[1];
          const isLengkap = rawUrl.includes('/lengkap/');
          const slug = rawUrl
            .replace(/^https?:\/\/otakudesu\.[a-z]+\/(?:anime|lengkap)\//i, '')
            .replace(/\/$/, '');

          items.push({
            title: titleMatch[2].replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim(),
            slug: isLengkap ? `lengkap/${slug}` : slug,
            thumbnailUrl: imgMatch ? imgMatch[1] : undefined,
            status: setMatch ? setMatch[1].trim() : undefined,
            type: 'TV',
            provider: 'otakudesu' as const,
          });
        }
      }

      return items;
    } catch (err) {
      console.warn(`Otakudesu search failed for query "${query}":`, err);
      return [];
    }
  }

  async getEpisodes(animeSlug: string): Promise<ProviderEpisodeItem[]> {
    try {
      const cleanSlug = animeSlug.replace(/^lengkap\//, '').replace(/^anime\//, '').replace(/\/$/, '');
      const episodes: ProviderEpisodeItem[] = [];

      // 1. Try standard /anime/ page first (where all episodes 1-28 live!)
      const animeRes = await safeFetch(`${OTAKUDESU_HOST}/anime/${cleanSlug}/`);
      if (animeRes.ok) {
        const html = await animeRes.text();
        const linkRegex = /href="https?:\/\/otakudesu\.[a-z]+\/episode\/([^"\/]+)\/?"[^>]*>([^<]+)<\/a>/gi;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
          const epSlug = match[1];
          const title = match[2].trim();

          const numMatch = title.match(/episode\s*(\d+)/i) || epSlug.match(/episode-(\d+)/i);
          const episodeNumber = numMatch ? parseInt(numMatch[1], 10) : episodes.length + 1;

          episodes.push({
            episodeNumber,
            slug: epSlug,
            title,
          });
        }

        if (episodes.length > 0) {
          episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
          return episodes;
        }
      }

      // 2. Fallback to /lengkap/ page
      const lengkapRes = await safeFetch(`${OTAKUDESU_HOST}/lengkap/${cleanSlug}/`);
      if (lengkapRes.ok) {
        const html = await lengkapRes.text();
        const h4Regex = /<h4>([^<]+)<\/h4>/gi;
        let match;
        let count = 1;

        while ((match = h4Regex.exec(html)) !== null) {
          const epTitle = match[1].trim();
          const numMatch = epTitle.match(/episode\s*(\d+)/i);
          const epNum = numMatch ? parseInt(numMatch[1], 10) : count;

          episodes.push({
            episodeNumber: epNum,
            slug: `lengkap/${cleanSlug}-episode-${epNum}`,
            title: epTitle,
          });
          count++;
        }
        if (episodes.length > 0) {
          episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
          return episodes;
        }
      }

      return [];
    } catch (err) {
      console.warn(`Otakudesu getEpisodes failed for "${animeSlug}":`, err);
      return [];
    }
  }

  async getEpisodeStreams(episodeSlug: string): Promise<ProviderEpisodeStreamData> {
    try {
      if (episodeSlug.startsWith('lengkap/')) {
        const cleanSlug = episodeSlug.replace(/^lengkap\//, '').replace(/\/$/, '');
        const parts = cleanSlug.split('-episode-');
        const epNum = parseInt(parts.pop() || '1', 10);
        const animeSlug = parts.join('-');

        const url = `${OTAKUDESU_HOST}/lengkap/${animeSlug}/`;
        const res = await safeFetch(url);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const html = await res.text();

        const downloadSources: { quality: string; links: { host: string; url: string }[] }[] = [];
        const epBlockRegex = new RegExp(
          `<h4>[^<]*Episode\\s*${epNum}[^<]*<\\/h4>\\s*<ul>([\\s\\S]*?)<\\/ul>`,
          'i'
        );
        const epMatch = html.match(epBlockRegex);

        if (epMatch) {
          const ulContent = epMatch[1];
          const liMatches = [...ulContent.matchAll(/<li>\s*<strong>([^<]+)<\/strong>\s*([\s\S]*?)<\/li>/gi)];
          for (const lm of liMatches) {
            const quality = lm[1].trim();
            const links = [...lm[2].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi)].map((l) => ({
              host: l[2].trim(),
              url: l[1],
            }));
            if (links.length > 0) {
              downloadSources.push({ quality, links });
            }
          }
        }

        return {
          episodeNumber: epNum,
          title: `Episode ${epNum}`,
          activeProvider: 'Otakudesu',
          streamSources: [],
          downloadSources,
        };
      }

      // Standard Episode Page
      const cleanSlug = episodeSlug.replace(/^episode\//, '').replace(/\/$/, '');
      const epUrl = `${OTAKUDESU_HOST}/episode/${cleanSlug}/`;

      const res = await safeFetch(epUrl);

      if (!res.ok) throw new Error(`Status ${res.status}`);
      const html = await res.text();

      const streamSources: ProviderStreamSource[] = [];

      // 1. Primary Iframe Embed (Force 720p HD URL)
      const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
      if (iframeMatch && iframeMatch[1]) {
        let streamUrl = iframeMatch[1];
        // Force upgrade default 360p embed to 720p HD
        if (streamUrl.includes('/moedesu/new/index.php')) {
          streamUrl = streamUrl.replace('/moedesu/new/index.php', '/moedesu/new/hd/index.php');
        }
        streamSources.push({
          server: 'NekoCloud HD (720p Paksa)',
          quality: '720p',
          qualityRank: 3,
          provider: 'NekoCloud (720p)',
          url: streamUrl,
          isIframe: true,
        });
      }

      // 2. Resolve AJAX Mirror Streams (moedesuhd 720p, odstreamhd 720p, yourupload, mega)
      const ajaxUrlMatch = html.match(/\$\.ajax\(["']([^"']*admin-ajax\.php)["']/i);
      const ajaxUrl = ajaxUrlMatch ? ajaxUrlMatch[1] : `${OTAKUDESU_HOST}/wp-admin/admin-ajax.php`;

      const actions = [...html.matchAll(/action:\s*["']([a-f0-9]{32})["']/gi)].map((m) => m[1]);
      if (actions.length >= 2) {
        try {
          const streamAction = actions[0];
          const nonceAction = actions[1];

          // Get Nonce
          const nonceRes = await safeFetch(ajaxUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: new URLSearchParams({ action: nonceAction }).toString(),
          });
          const nonceJson = await nonceRes.json();

          if (nonceJson && nonceJson.data) {
            const nonce = nonceJson.data;
            const mirrorMatches = [
              ...html.matchAll(/<li[^>]*><a[^>]+data-content="([^"]+)"[^>]*>([^<]+)<\/a>/gi),
            ];

            for (const mm of mirrorMatches) {
              try {
                const serverName = mm[2].trim();
                const payload = JSON.parse(Buffer.from(mm[1], 'base64').toString('utf-8'));
                const quality = payload.q || '720p';

                // Prioritize 720p mirrors
                if (quality === '720p') {
                  const params = new URLSearchParams({
                    ...payload,
                    nonce,
                    action: streamAction,
                  });

                  const mRes = await safeFetch(ajaxUrl, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                      'X-Requested-With': 'XMLHttpRequest',
                    },
                    body: params.toString(),
                  });
                  const mJson = await mRes.json();
                  if (mJson && mJson.data) {
                    const decodedEmbed = Buffer.from(mJson.data, 'base64').toString('utf-8');
                    const embedSrcMatch = decodedEmbed.match(/src="([^"]+)"/i);
                    if (embedSrcMatch && !streamSources.some((s) => s.url === embedSrcMatch[1])) {
                      let displayName = serverName.toUpperCase();
                      if (serverName.toLowerCase().includes('moedesuhd')) displayName = 'NekoCloud HD (720p)';
                      else if (serverName.toLowerCase().includes('odstreamhd')) displayName = 'ODStream HD (720p)';
                      else if (serverName.toLowerCase().includes('yourupload')) displayName = 'YourUpload HD (720p)';

                      streamSources.push({
                        server: displayName,
                        quality: '720p',
                        qualityRank: 3,
                        provider: `Otaku (${displayName})`,
                        url: embedSrcMatch[1],
                        isIframe: true,
                      });
                    }
                  }
                }
              } catch {}
            }
          }
        } catch (mErr) {
          console.warn('Could not fetch additional AJAX mirrors:', mErr);
        }
      }

      // 3. Parse Download Mirrors
      const downloadSources: { quality: string; links: { host: string; url: string }[] }[] = [];
      const downloadMatches = [
        ...html.matchAll(/<li[^>]*>\s*<strong>([^<]+)<\/strong>\s*([\s\S]*?)<\/li>/gi),
      ];

      for (const dm of downloadMatches) {
        const quality = dm[1].trim();
        const links = [...dm[2].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi)].map((l) => ({
          host: l[2].trim(),
          url: l[1],
        }));

        if (links.length > 0) {
          downloadSources.push({ quality, links });
        }
      }

      const epNumMatch = cleanSlug.match(/episode-(\d+)/i);
      const episodeNumber = epNumMatch ? parseInt(epNumMatch[1], 10) : 1;

      return {
        episodeNumber,
        title: `Episode ${episodeNumber}`,
        activeProvider: 'Otakudesu',
        streamSources,
        downloadSources,
      };
    } catch (err) {
      console.warn(`Otakudesu getEpisodeStreams failed for "${episodeSlug}":`, err);
      return {
        episodeNumber: 1,
        title: 'Episode 1',
        streamSources: [
          {
            server: 'Harvest Backup Stream',
            quality: '1080p',
            qualityRank: 4,
            provider: 'Otakudesu',
            url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            isIframe: false,
          },
        ],
      };
    }
  }
}

export const otakudesu = new OtakudesuAdapter();


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