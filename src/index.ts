import express from 'express';
import cors from 'cors';
import { searchOtakudesu, getOtakudesuEpisodes, getOtakudesuStreams } from './providers/otakudesu.js';
import { searchKusonime, getKusonimeStreams } from './providers/kusonime.js';
import { searchWinbu, getWinbuEpisodes, getWinbuStreams } from './providers/winbu.js';

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
    const [otaku, kuso, winbu] = await Promise.allSettled([
      searchOtakudesu(q),
      searchKusonime(q),
      searchWinbu(q),
    ]);

    const results = [
      ...(otaku.status === 'fulfilled' ? otaku.value : []),
      ...(kuso.status === 'fulfilled' ? kuso.value : []),
      ...(winbu.status === 'fulfilled' ? winbu.value : []),
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
    }
    res.json({ provider, slug, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Anime Scraper API is running on port ${PORT}`);
});