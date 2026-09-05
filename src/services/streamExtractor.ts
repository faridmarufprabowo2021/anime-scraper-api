import type { StreamSource, DownloadSource, EpisodeStreams } from '../types.ts';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Dean Edwards P.A.C.K.E.R. Unpacker (Base36 / Base62)
 */
export function unpackDeanEdwards(packedCode: string): string {
  try {
    const match = packedCode.match(/}\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
    if (!match) return packedCode;

    const p = match[1];
    const a = parseInt(match[2], 10);
    const c = parseInt(match[3], 10);
    const k = match[4].split('|');

    const e = (n: number): string => {
      return (n < a ? '' : e(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    };

    const dict: Record<string, string> = {};
    for (let i = 0; i < c; i++) {
      dict[e(i)] = k[i] || e(i);
    }

    return p.replace(/\b\w+\b/g, (w) => dict[w] ?? w);
  } catch (err) {
    console.warn('[Unpack Error]:', err);
    return packedCode;
  }
}

/**
 * Resolves master.m3u8 to sub-manifest (index-v1-a1.m3u8?t=...) with full authentication tokens.
 * This prevents 403 Forbidden errors when player fails relative resolution.
 */
export async function resolveDirectHlsPlaylist(masterM3u8Url: string, referer?: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(masterM3u8Url, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(referer ? { 'Referer': referer } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return masterM3u8Url;
    const text = await res.text();

    const baseUrl = masterM3u8Url.substring(0, masterM3u8Url.lastIndexOf('/') + 1);

    // Look for sub-manifest with token query (e.g. index-v1-a1.m3u8?t=...)
    const subMatch = text.match(/([a-zA-Z0-9_\-\.\/]+?\.m3u8\?[^\r\n]+)/) ||
                     text.match(/([a-zA-Z0-9_\-\.\/]+?\.m3u8)/);

    if (subMatch && subMatch[1]) {
      const subPath = subMatch[1].trim();
      if (subPath.startsWith('http://') || subPath.startsWith('https://')) {
        return subPath;
      }
      return baseUrl + subPath;
    }

    return masterM3u8Url;
  } catch {
    return masterM3u8Url;
  }
}

/**
 * Extracts direct HLS (.m3u8) from Vidhide / Morencius / Peytonepre / Streamsilk
 */
export async function extractVidhide(rawUrl: string): Promise<string | null> {
  try {
    const embedUrl = rawUrl
      .replace('/file/', '/embed/')
      .replace('/download/', '/embed/');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': embedUrl,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const html = await res.text();

    // 1. Try Dean Edwards unpack
    const unpacked = unpackDeanEdwards(html);

    // 2. Look for master.m3u8 or hls2/hls3 URL
    const m3u8Match = unpacked.match(/https?:\/\/[^\s"'`\\]+?\.m3u8[^\s"'`\\]*/);
    if (m3u8Match) {
      const masterUrl = m3u8Match[0];
      const refererHost = new URL(embedUrl).origin;
      return await resolveDirectHlsPlaylist(masterUrl, refererHost);
    }

    return null;
  } catch (err) {
    console.warn('[Vidhide Extract Error]:', err);
    return null;
  }
}

/**
 * Extracts direct HLS (.m3u8) from Streamwish / Filelions / Filemoon
 */
export async function extractStreamwish(rawUrl: string): Promise<string | null> {
  try {
    let embedUrl = rawUrl;
    if (embedUrl.includes('/d/')) embedUrl = embedUrl.replace('/d/', '/e/');
    if (embedUrl.includes('/f/')) embedUrl = embedUrl.replace('/f/', '/e/');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': embedUrl,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const html = await res.text();

    // Check direct jwplayer sources
    const jwMatch = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (jwMatch && jwMatch[1]) {
      return jwMatch[1];
    }

    // Try Dean Edwards unpack
    const unpacked = unpackDeanEdwards(html);
    const m3u8Match = unpacked.match(/https?:\/\/[^\s"'`\\]+?\.m3u8[^\s"'`\\]*/);
    if (m3u8Match) {
      return m3u8Match[0];
    }

    return null;
  } catch (err) {
    console.warn('[Streamwish Extract Error]:', err);
    return null;
  }
}

/**
 * Extracts direct MP4 or HLS from Filedon
 */
export async function extractFiledon(rawUrl: string): Promise<{ mp4Url?: string; hlsUrl?: string } | null> {
  try {
    const embedUrl = rawUrl.replace('/view/', '/embed/');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const html = await res.text();

    const pageMatch = html.match(/data-page="([^"]+)"/);
    if (pageMatch) {
      const rawJson = pageMatch[1].replace(/&quot;/g, '"');
      const data = JSON.parse(rawJson);
      const props = data?.props;

      const rawMp4 = props?.url ? props.url.replace(/&amp;/g, '&') : undefined;
      const rawHls = props?.media?.hls_url ? props.media.hls_url.replace(/&amp;/g, '&') : undefined;

      if (rawMp4 || rawHls) {
        return {
          mp4Url: rawMp4,
          hlsUrl: rawHls,
        };
      }
    }

    return null;
  } catch (err) {
    console.warn('[Filedon Extract Error]:', err);
    return null;
  }
}

/**
 * Converts Pixeldrain view URL to direct streaming endpoint
 */
export function extractPixeldrain(rawUrl: string): string | null {
  if (!rawUrl.includes('pixeldrain.com')) return null;
  const match = rawUrl.match(/\/u\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://pixeldrain.com/api/file/${match[1]}`;
  }
  if (rawUrl.includes('/api/file/')) return rawUrl;
  return null;
}

/**
 * Automatically extracts any supported provider into a direct stream
 */
export async function autoExtractStream(
  url: string,
  serverName = ''
): Promise<{ url: string; isIframe: boolean; isM3U8: boolean; headers?: Record<string, string> } | null> {
  const lowerUrl = url.toLowerCase();
  const lowerServer = serverName.toLowerCase();

  // 1. Pixeldrain Direct MP4
  const pd = extractPixeldrain(url);
  if (pd) {
    return { url: pd, isIframe: false, isM3U8: false };
  }

  // 2. Vidhide / Morencius / Peytonepre / Streamsilk HLS
  const isVidhide =
    lowerUrl.includes('vidhide') ||
    lowerUrl.includes('morencius') ||
    lowerUrl.includes('peytonepre') ||
    lowerUrl.includes('streamsilk') ||
    lowerUrl.includes('streamhide') ||
    lowerUrl.includes('odvidhide') ||
    lowerUrl.includes('myviid') ||
    lowerServer.includes('vidhide');

  if (isVidhide) {
    const hls = await extractVidhide(url);
    if (hls) {
      const host = new URL(url).host;
      return {
        url: hls,
        isIframe: false,
        isM3U8: true,
        headers: { 'Referer': `https://${host}/` },
      };
    }
  }

  // 3. Streamwish / Filelions / Filemoon HLS
  const isStreamwish =
    lowerUrl.includes('streamwish') ||
    lowerUrl.includes('filelions') ||
    lowerUrl.includes('filemoon') ||
    lowerUrl.includes('wishembed') ||
    lowerUrl.includes('dwish') ||
    lowerUrl.includes('embedwish') ||
    lowerServer.includes('streamwish') ||
    lowerServer.includes('filelions');

  if (isStreamwish) {
    const hls = await extractStreamwish(url);
    if (hls) {
      return { url: hls, isIframe: false, isM3U8: true };
    }
  }

  // 4. Filedon Direct MP4 / HLS
  const isFiledon = lowerUrl.includes('filedon.co') || lowerServer.includes('filedon');
  if (isFiledon) {
    const filedon = await extractFiledon(url);
    if (filedon?.hlsUrl) {
      return { url: filedon.hlsUrl, isIframe: false, isM3U8: true };
    }
    if (filedon?.mp4Url) {
      return {
        url: filedon.mp4Url,
        isIframe: false,
        isM3U8: false,
        headers: { 'Referer': 'https://filedon.co/' },
      };
    }
  }

  return null;
}

/**
 * Enriches EpisodeStreams:
 * 1. Promotes high-speed direct downloads (Pixeldrain, Filedon) to native streamSources
 * 2. Unpacks embed URLs (Vidhide, Streamwish) into direct HLS/MP4
 * 3. Sorts streamSources by quality
 */
export async function enrichEpisodeStreams(data: EpisodeStreams): Promise<EpisodeStreams> {
  const streamSources: StreamSource[] = [...(data.streamSources || [])];
  const downloadSources: DownloadSource[] = [...(data.downloadSources || [])];

  const tasks: Promise<void>[] = [];

  // A. Promote downloads (Pixeldrain, Filedon, Vidhide) to native streams
  for (const dl of downloadSources) {
    const quality = dl.quality || '720p';
    let rank = 3;
    if (quality.includes('1080')) rank = 4;
    else if (quality.includes('720')) rank = 3;
    else if (quality.includes('480')) rank = 2;
    else if (quality.includes('360')) rank = 1;

    for (const link of dl.links || []) {
      const host = (link.host || '').toLowerCase();
      const url = link.url || '';

      // Pixeldrain Direct Promotion
      if (host.includes('pixeldrain') || url.includes('pixeldrain.com/u/')) {
        const directUrl = extractPixeldrain(url);
        if (directUrl && !streamSources.some((s) => s.url === directUrl)) {
          streamSources.unshift({
            server: `Pixeldrain Direct (${quality})`,
            quality: quality.replace('MP4 ', ''),
            qualityRank: rank + 1, // High priority
            provider: 'pixeldrain',
            url: directUrl,
            isIframe: false,
          });
        }
      }

      // Vidhide Download Promotion
      if (
        host.includes('vidhide') ||
        url.includes('morencius') ||
        url.includes('peytonepre') ||
        url.includes('vidhide')
      ) {
        tasks.push(
          (async () => {
            const hls = await extractVidhide(url);
            if (hls && !streamSources.some((s) => s.url === hls)) {
              streamSources.unshift({
                server: `Vidhide Direct HLS (${quality})`,
                quality: quality.replace('MP4 ', ''),
                qualityRank: rank + 1,
                provider: 'vidhide',
                url: hls,
                isIframe: false,
              });
            }
          })()
        );
      }

      // Filedon Promotion
      if (host.includes('filedon') || url.includes('filedon.co')) {
        tasks.push(
          (async () => {
            const res = await extractFiledon(url);
            if (res?.mp4Url && !streamSources.some((s) => s.url === res.mp4Url)) {
              streamSources.unshift({
                server: `Filedon Fast MP4 (${quality})`,
                quality: quality.replace('MP4 ', ''),
                qualityRank: rank + 1,
                provider: 'filedon',
                url: res.mp4Url,
                isIframe: false,
              });
            }
          })()
        );
      }
    }
  }

  // B. Unpack existing iframe streams (Vidhide, Streamwish, etc.)
  for (let i = 0; i < streamSources.length; i++) {
    const s = streamSources[i];
    if (s.isIframe !== false) {
      tasks.push(
        (async () => {
          const direct = await autoExtractStream(s.url, s.server);
          if (direct) {
            streamSources[i] = {
              ...s,
              url: direct.url,
              isIframe: direct.isIframe,
              server: direct.isM3U8 ? `${s.server} [HLS Direct]` : `${s.server} [Direct]`,
            };
          }
        })()
      );
    }
  }

  if (tasks.length > 0) {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((r) => setTimeout(r, 4500)),
    ]);
  }

  // Sort descending by quality rank
  streamSources.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

  return {
    ...data,
    streamSources,
    downloadSources,
  };
}
