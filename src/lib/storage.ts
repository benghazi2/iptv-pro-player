const CACHE_KEY = 'iptv_channels_cache_v2';
const IDB_NAME = 'iptv_pro_db';
const IDB_STORE = 'kv';
const LAST_CH_KEY = 'iptv_last_channel_id';
const FAVS_KEY = 'iptv_favs_local';

interface CachePayload {
  channels: import('../types').Channel[];
  source: import('../types').SourceInfo;
  ts: number;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB غير مدعوم')); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(tx.error);
  });
}

export async function saveChannelsCache(channels: import('../types').Channel[], source: import('../types').SourceInfo): Promise<void> {
  const payload: CachePayload = { channels, source, ts: Date.now() };
  try {
    await idbSet(CACHE_KEY, payload);
    localStorage.removeItem(CACHE_KEY);
  } catch (e) {
    console.warn('[Cache] فشل الحفظ، محاولة خطة بديلة:', e);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (e2) { console.warn('[Cache] تعذر الحفظ:', e2); }
  }
}

export async function loadChannelsCache(): Promise<CachePayload | null> {
  try {
    const fromIdb = await idbGet<CachePayload>(CACHE_KEY);
    if (fromIdb) return fromIdb;
  } catch (e) { console.warn('[Cache] خطأ IndexedDB:', e); }
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export async function clearChannelsCache(): Promise<void> {
  localStorage.removeItem(CACHE_KEY);
  try { await idbSet(CACHE_KEY, null); } catch (e) {}
}

export function saveLastChannel(id: string): void {
  try { localStorage.setItem(LAST_CH_KEY, id); } catch (e) {}
}

export function getLastChannelId(): string | null {
  try { return localStorage.getItem(LAST_CH_KEY); } catch (e) { return null; }
}

export function getLocalFavs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]'));
  } catch { return new Set(); }
}

export function saveLocalFavs(favs: Set<string>): void {
  try { localStorage.setItem(FAVS_KEY, JSON.stringify([...favs])); } catch (e) {}
}
