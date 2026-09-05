import { searchOtakudesu, getOtakudesuEpisodes, getOtakudesuStreams } from './src/providers/otakudesu.ts';
import { searchKusonime, getKusonimeStreams } from './src/providers/kusonime.ts';
import { searchWinbu, getWinbuEpisodes, getWinbuStreams } from './src/providers/winbu.ts';
import { searchSamehadaku, getSamehadakuEpisodes, getSamehadakuStreams } from './src/providers/samehadaku.ts';
import { searchConsumet, getConsumetEpisodes, getConsumetStreams } from './src/providers/consumet.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 1. Health
  if (path === '/' || path === '/health') {
    return new Response(
      JSON.stringify({
        status: 'ok',
        service: 'Anime Scraper API (Deno Edge)',
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  // 2. Search
  if (path === '/api/search') {
    const q = url.searchParams.get('q') || '';
    if (!q) {
      return new Response(JSON.stringify({ error: 'Query parameter q is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const [otaku, kuso, winbu, same, consumet] = await Promise.allSettled([
      searchOtakudesu(q),
      searchKusonime(q),
      searchWinbu(q),
      searchSamehadaku(q),
      searchConsumet(q),
    ]);

    const results = [
      ...(winbu.status === 'fulfilled' ? winbu.value : []),
      ...(same.status === 'fulfilled' ? same.value : []),
      ...(otaku.status === 'fulfilled' ? otaku.value : []),
      ...(kuso.status === 'fulfilled' ? kuso.value : []),
      ...(consumet.status === 'fulfilled' ? consumet.value : []),
    ];

    return new Response(JSON.stringify({ query: q, count: results.length, results }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  // 3. Episodes
  if (path === '/api/episodes') {
    const provider = (url.searchParams.get('provider') || 'otakudesu').toLowerCase();
    const slug = url.searchParams.get('slug') || '';
    if (!slug) {
      return new Response(JSON.stringify({ error: 'Slug is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    let episodes: any[] = [];
    if (provider === 'consumet') episodes = await getConsumetEpisodes(slug);
    else if (provider === 'winbu') episodes = await getWinbuEpisodes(slug);
    else if (provider === 'samehadaku') episodes = await getSamehadakuEpisodes(slug);
    else if (provider === 'otakudesu') episodes = await getOtakudesuEpisodes(slug);

    return new Response(JSON.stringify({ provider, slug, count: episodes.length, episodes }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  // 4. Streams
  if (path === '/api/streams') {
    const provider = (url.searchParams.get('provider') || 'otakudesu').toLowerCase();
    const slug = url.searchParams.get('slug') || '';
    if (!slug) {
      return new Response(JSON.stringify({ error: 'Slug is required' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    let data: any = { streamSources: [], downloadSources: [] };
    if (provider === 'consumet') data = await getConsumetStreams(slug);
    else if (provider === 'winbu') data = await getWinbuStreams(slug);
    else if (provider === 'samehadaku') data = await getSamehadakuStreams(slug);
    else if (provider === 'otakudesu') data = await getOtakudesuStreams(slug);
    else if (provider === 'kusonime') data = await getKusonimeStreams(slug);

    return new Response(JSON.stringify({ provider, slug, data }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  // 5. Debug Consumet
  if (path === '/api/debug-consumet') {
    const q = url.searchParams.get('q') || 'Frieren';
    try {
      const res = await fetch(`https://www.animeunity.to/archivio?title=${encodeURIComponent(q)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });
      const text = await res.text();
      return new Response(JSON.stringify({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        htmlLength: text.length,
        hasArchivio: text.includes('archivio'),
        snippet: text.slice(0, 500)
      }), {
        status: 200,
        headers: corsHeaders
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: corsHeaders,
  });
});