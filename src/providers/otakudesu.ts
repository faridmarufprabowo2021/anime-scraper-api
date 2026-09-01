import * as cheerio from 'cheerio';
import { safeFetch } from '../services/httpClient.js';
import type { SearchResult, EpisodeItem, EpisodeStreams, StreamSource, DownloadSource } from '../types.js';

const HOST = 'https://otakudesu.blog';

export async function searchOtakudesu(query: string): Promise<SearchResult[]> {
  try {
    const res = await safeFetch(`${HOST}/?s=${encodeURIComponent(query)}&post_type=anime`);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('.chivsrc li').each((_, el) => {
      const title = $(el).find('h2 a').text().trim();
      const href = $(el).find('h2 a').attr('href') || '';
      const thumb = $(el).find('img').attr('src') || '';
      const slugMatch = href.match(/\/anime\/([^/]+)/);
      if (slugMatch && title) {
        results.push({
          title,
          slug: slugMatch[1],
          thumbnailUrl: thumb,
          provider: 'otakudesu',
        });
      }
    });
    return results;
  } catch {
    return [];
  }
}

export async function getOtakudesuEpisodes(slug: string): Promise<EpisodeItem[]> {
  try {
    const res = await safeFetch(`${HOST}/anime/${slug}/`);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const episodes: EpisodeItem[] = [];

    $('.episodelist ul li').each((_, el) => {
      const a = $(el).find('a');
      const href = a.attr('href') || '';
      const title = a.text().trim();
      const epMatch = href.match(/\/episode\/([^/]+)/);
      if (epMatch) {
        let epNum = 0;
        const numM = title.match(/Episode\s*(\d+)/i) || epMatch[1].match(/episode-(\d+)/i);
        if (numM) epNum = parseInt(numM[1], 10);
        episodes.push({
          episodeNumber: epNum || 1,
          slug: epMatch[1],
          title,
        });
      }
    });
    return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  } catch {
    return [];
  }
}

export async function getOtakudesuStreams(epSlug: string): Promise<EpisodeStreams> {
  try {
    const res = await safeFetch(`${HOST}/episode/${epSlug}/`);
    if (!res.ok) return { episodeNumber: 1, title: 'Episode', streamSources: [] };
    const html = await res.text();
    const $ = cheerio.load(html);

    const streamSources: StreamSource[] = [];
    const downloadSources: DownloadSource[] = [];

    const iframeSrc = $('iframe').attr('src');
    if (iframeSrc) {
      let u = iframeSrc;
      if (u.includes('/moedesu/new/index.php')) {
        u = u.replace('/moedesu/new/index.php', '/moedesu/new/hd/index.php');
      }
      streamSources.push({
        server: 'NekoCloud HD (720p)',
        quality: '720p',
        qualityRank: 3,
        provider: 'otakudesu',
        url: u,
        isIframe: true,
      });
    }

    $('.mirrorstream ul li').each((_, el) => {
      const a = $(el).find('a');
      const label = a.text().trim();
      const dataContent = a.attr('data-content');
      if (dataContent) {
        try {
          const decoded = Buffer.from(dataContent, 'base64').toString('utf-8');
          const iMatch = decoded.match(/src="([^"]+)"/);
          if (iMatch && iMatch[1]) {
            let rank = 2;
            let q = '480p';
            if (label.includes('720')) { rank = 3; q = '720p'; }
            if (label.includes('1080')) { rank = 4; q = '1080p'; }
            streamSources.push({
              server: label,
              quality: q,
              qualityRank: rank,
              provider: 'otakudesu',
              url: iMatch[1],
              isIframe: true,
            });
          }
        } catch {}
      }
    });

    $('.download ul li').each((_, el) => {
      const strong = $(el).find('strong').text().trim();
      const links: { host: string; url: string }[] = [];
      $(el).find('a').each((_, la) => {
        const h = $(la).text().trim();
        const u = $(la).attr('href') || '';
        if (h && u) links.push({ host: h, url: u });
      });
      if (links.length > 0) {
        downloadSources.push({ quality: strong, links });
      }
    });

    let epNum = 1;
    const numM = epSlug.match(/episode-(\d+)/i);
    if (numM) epNum = parseInt(numM[1], 10);

    return {
      episodeNumber: epNum,
      title: $('h1.posttl').text().trim() || `Episode ${epNum}`,
      streamSources,
      downloadSources,
    };
  } catch {
    return { episodeNumber: 1, title: 'Episode', streamSources: [] };
  }
}