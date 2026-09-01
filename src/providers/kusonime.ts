import * as cheerio from 'cheerio';
import { safeFetch } from '../services/httpClient.js';
import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.js';

const HOST = 'https://kusonime.com';

export async function searchKusonime(query: string): Promise<SearchResult[]> {
  try {
    const res = await safeFetch(`${HOST}/?s=${encodeURIComponent(query)}&post_type=anime`);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('.venz ul li .detpost').each((_, el) => {
      const a = $(el).find('.content h2 a');
      const title = a.text().trim();
      const href = a.attr('href') || '';
      const thumb = $(el).find('.thumb z img').attr('src') || $(el).find('img').attr('src') || '';
      const slugMatch = href.match(/https:\/\/kusonime\.com\/([^/]+)/);
      if (slugMatch && title) {
        results.push({
          title,
          slug: slugMatch[1],
          thumbnailUrl: thumb,
          provider: 'kusonime',
        });
      }
    });
    return results;
  } catch {
    return [];
  }
}

export async function getKusonimeStreams(slug: string): Promise<EpisodeStreams> {
  try {
    const res = await safeFetch(`${HOST}/${slug}/`);
    if (!res.ok) return { episodeNumber: 1, title: 'Kusonime Batch', streamSources: [] };
    const html = await res.text();
    const $ = cheerio.load(html);

    const streamSources: StreamSource[] = [];
    const downloadSources: DownloadSource[] = [];

    $('.smokedl .smokeurl').each((_, el) => {
      const quality = $(el).find('strong').text().trim();
      const links: { host: string; url: string }[] = [];
      $(el).find('a').each((_, a) => {
        const host = $(a).text().trim();
        const url = $(a).attr('href') || '';
        if (host && url) {
          links.push({ host, url });
          if (url.includes('drive.google.com/file/d/')) {
            const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (m) {
              streamSources.push({
                server: `Google Drive ${quality}`,
                quality: quality.includes('1080') ? '1080p' : '720p',
                qualityRank: quality.includes('1080') ? 4 : 3,
                provider: 'kusonime',
                url: `https://drive.google.com/file/d/${m[1]}/preview`,
                isIframe: true,
              });
            }
          } else if (url.includes('acefile.co/f/')) {
            streamSources.push({
              server: `AceFile FastCDN ${quality}`,
              quality: quality.includes('1080') ? '1080p' : '720p',
              qualityRank: quality.includes('1080') ? 4 : 3,
              provider: 'kusonime',
              url: url.replace('/f/', '/player/'),
              isIframe: true,
            });
          }
        }
      });
      if (links.length > 0) {
        downloadSources.push({ quality, links });
      }
    });

    return {
      episodeNumber: 1,
      title: $('h1.jdl').text().trim() || 'Kusonime',
      streamSources,
      downloadSources,
    };
  } catch {
    return { episodeNumber: 1, title: 'Kusonime', streamSources: [] };
  }
}