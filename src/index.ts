import express from 'express';
import cors from 'cors';
import { searchOtakudesu, getOtakudesuEpisodes, getOtakudesuStreams } from './providers/otakudesu.js';
import { searchKusonime, getKusonimeStreams } from './providers/kusonime.js';
import { searchWinbu, getWinbuEpisodes, getWinbuStreams } from './providers/winbu.js';
import { searchSamehadaku, getSamehadakuEpisodes, getSamehadakuStreams } from './providers/samehadaku.js';
import { enrichEpisodeStreams, autoExtractStream } from './services/streamExtractor.js';

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Anime Scraper API Microservice',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 2. Multi-Provider Search
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

  try {
    const [otaku, kuso, winbu, same] = await Promise.allSettled([
      searchOtakudesu(q),
      searchKusonime(q),
      searchWinbu(q),
      searchSamehadaku(q),
    ]);

    const results = [
      ...(winbu.status === 'fulfilled' ? winbu.value : []),
      ...(same.status === 'fulfilled' ? same.value : []),
      ...(otaku.status === 'fulfilled' ? otaku.value : []),
      ...(kuso.status === 'fulfilled' ? kuso.value : []),
    ];

    res.json({ query: q, count: results.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get Episodes
app.get('/api/episodes', async (req, res) => {
  const provider = String(req.query.provider || 'otakudesu').toLowerCase();
  const slug = String(req.query.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'Slug parameter is required' });

  try {
    let episodes: any[] = [];
    if (provider === 'otakudesu') {
      episodes = await getOtakudesuEpisodes(slug);
    } else if (provider === 'winbu') {
      episodes = await getWinbuEpisodes(slug);
    } else if (provider === 'samehadaku') {
      episodes = await getSamehadakuEpisodes(slug);
    }
    res.json({ provider, slug, count: episodes.length, episodes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Streams & Downloads
app.get('/api/streams', async (req, res) => {
  const provider = String(req.query.provider || 'otakudesu').toLowerCase();
  const slug = String(req.query.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'Slug parameter is required' });

  try {
    let data: any = { streamSources: [], downloadSources: [] };
    if (provider === 'otakudesu') {
      data = await getOtakudesuStreams(slug);
    } else if (provider === 'kusonime') {
      data = await getKusonimeStreams(slug);
    } else if (provider === 'winbu') {
      data = await getWinbuStreams(slug);
    } else if (provider === 'samehadaku') {
      data = await getSamehadakuStreams(slug);
    }

    // Automatically enrich and unpack all streams into direct HLS & direct MP4
    data = await enrichEpisodeStreams(data);

    res.json({ provider, slug, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Universal Direct Stream Extractor (Vidhide, Streamwish, Filedon, Pixeldrain)
app.get('/api/extract', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  const serverName = String(req.query.server || '').trim();
  if (!targetUrl) return res.status(400).json({ error: 'url query parameter is required' });

  try {
    const result = await autoExtractStream(targetUrl, serverName);
    res.json({
      success: Boolean(result),
      url: targetUrl,
      extracted: result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Anime Scraper API is running on port ${PORT}`);
});