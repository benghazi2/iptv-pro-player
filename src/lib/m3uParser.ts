import { Channel } from '../types';

export function parseExtInf(line: string): Channel {
  const ch: Channel = {
    id: Math.random().toString(36).substr(2, 9),
    name: '',
    logo: '',
    group: 'غير مصنف',
    url: '',
    type: 'live',
    kind: 'live',
  };

  const re = /(\w[\w-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    switch (m[1]) {
      case 'tvg-name': ch.name = m[2]; break;
      case 'tvg-logo': ch.logo = m[2]; break;
      case 'group-title': ch.group = m[2] || 'غير مصنف'; break;
      case 'tvg-id': ch.tvgId = m[2]; break;
    }
  }

  const ci = line.lastIndexOf(',');
  if (ci !== -1) {
    const n = line.substring(ci + 1).trim();
    if (n && (!ch.name || n.length > ch.name.length)) ch.name = n;
  }

  if (!ch.name) ch.name = 'قناة غير معروفة';
  return ch;
}

export function classifyChannel(ch: Channel): void {
  const url = (ch.url || '').toLowerCase();
  const grp = (ch.group || '');

  if (/\/movie\//.test(url) || /\/movies\//.test(url) || /\/vod\//.test(url)) {
    ch.kind = 'movie'; return;
  }
  if (/\/series\//.test(url)) { ch.kind = 'series'; return; }

  const movieKw = ['فيلم', 'أفلام', 'افلام', 'movies', 'vod'];
  const seriesKw = ['مسلسل', 'مسلسلات', 'series'];

  if (movieKw.some(k => grp.includes(k))) { ch.kind = 'movie'; return; }
  if (seriesKw.some(k => grp.includes(k))) { ch.kind = 'series'; return; }
  ch.kind = 'live';
}

export function beinScore(ch: Channel): number {
  const n = ch.name || '';
  const nl = n.toLowerCase();
  const isBein = /bein\s*sport/i.test(nl) || /بي\s*ان\s*سبورت/i.test(n);
  if (!isBein) return 0;
  const isArabic = /[\u0600-\u06FF]/.test(n) || /\bAR\b/i.test(n) || /عربي/.test(n);
  return isArabic ? 3 : 2;
}

export function sortWithBeinPriority(list: Channel[]): Channel[] {
  return list
    .map((ch, i) => ({ ch, i }))
    .sort((a, b) => {
      const diff = beinScore(b.ch) - beinScore(a.ch);
      return diff !== 0 ? diff : a.i - b.i;
    })
    .map(x => x.ch);
}

export async function parseM3uProgressive(
  text: string,
  onChannel: (ch: Channel) => void,
  onProgress: (count: number, progress: number) => void
): Promise<number> {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  const total = lines.length;
  let ch: Channel | null = null;
  let count = 0;
  let processed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    processed++;

    if (line.startsWith('#EXTINF')) {
      ch = parseExtInf(line);
    } else if (line && !line.startsWith('#')) {
      if (ch) {
        ch.url = line;
        classifyChannel(ch);
        onChannel(ch);
        count++;
        ch = null;
      }
    }

    if (i % 100 === 0) {
      onProgress(count, processed / total);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  onProgress(count, 1);
  return count;
}

export function detectStreamKind(url: string): 'hls' | 'ts' | 'direct' | 'unknown' {
  if (!url) return 'unknown';
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.endsWith('.mp4') || lower.endsWith('.mp3') || lower.endsWith('.webm') || lower.endsWith('.ogg') || lower.endsWith('.aac')) return 'direct';
  if (lower.endsWith('.ts')) return 'ts';
  try {
    const u = new URL(url);
    const path = u.pathname;
    const lastSeg = path.split('/').filter(Boolean).pop() || '';
    if (/^\\d+$/.test(lastSeg)) return 'ts';
    if (!lastSeg.includes('.')) return 'unknown';
  } catch (e) {}
  return 'unknown';
}

export function escapeHtml(s: string): string {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
