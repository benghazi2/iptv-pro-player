import supabase from './db-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    console.log('[Proxy] Fetching:', decodedUrl.substring(0, 120));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const fetchRes = await fetch(decodedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ error: `HTTP ${fetchRes.status}` });
    }

    const contentType = fetchRes.headers.get('content-type') || '';
    
    // For M3U/M3U8 text content - return as text
    if (contentType.includes('text') || contentType.includes('mpegurl') || contentType.includes('m3u')) {
      const text = await fetchRes.text();
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(text);
    }

    // For video/audio streams - pipe through
    res.setHeader('Content-Type', contentType || 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buffer = await fetchRes.arrayBuffer();
    return new Promise((resolve) => {
      res.write(Buffer.from(buffer));
      res.end();
      resolve(true);
    });
  } catch (err) {
    console.error('[Proxy] Error:', err.message);
    return res.status(500).json({ error: err.message || 'Proxy error' });
  }
}
