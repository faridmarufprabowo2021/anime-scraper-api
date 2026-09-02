import { searchOtakudesu, getOtakudesuEpisodes, getOtakudesuStreams } from './src/providers/otakudesu.ts';
import { searchKusonime, getKusonimeStreams } from './src/providers/kusonime.ts';
import { searchWinbu, getWinbuEpisodes, getWinbuStreams } from './src/providers/winbu.ts';
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

    const [otaku, kuso, winbu, consumet] = await Promise.allSettled([
      searchOtakudesu(q),
      searchKusonime(q),
      searchWinbu(q),
      searchConsumet(q),
    ]);

    const results = [
      ...(consumet.status === 'fulfilled' ? consumet.value : []),
      ...(otaku.status === 'fulfilled' ? otaku.value : []),
      ...(kuso.status === 'fulfilled' ? kuso.value : []),
      ...(winbu.status === 'fulfilled' ? winbu.value : []),
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
    else if (provider === 'otakudesu') episodes = await getOtakudesuEpisodes(slug);
    else if (provider === 'winbu') episodes = await getWinbuEpisodes(slug);

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
    else if (provider === 'otakudesu') data = await getOtakudesuStreams(slug);
    else if (provider === 'kusonime') data = await getKusonimeStreams(slug);
    else if (provider === 'winbu') data = await getWinbuStreams(slug);

    return new Response(JSON.stringify({ provider, slug, data }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: corsHeaders,
  });
});