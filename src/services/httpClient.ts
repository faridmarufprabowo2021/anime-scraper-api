const cache = new Map<string, { text: string; expiresAt: number }>();

export async function safeFetch(url: string, options: any = {}): Promise<Response> {
  const method = options.method || 'GET';
  const now = Date.now();
  if (method === 'GET') {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > now) {
      return new Response(hit.text, { status: 200, statusText: 'OK (Cached)' });
    }
  }

  const controller = new AbortController();
  const tId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    clearTimeout(tId);
    const text = await res.text();
    if (res.ok && method === 'GET') {
      cache.set(url, { text, expiresAt: now + 5 * 60 * 1000 });
    }
    return new Response(text, { status: res.status, headers: res.headers });
  } catch (e) {
    clearTimeout(tId);
    throw e;
  }
}