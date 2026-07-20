import { useState, useEffect, useCallback, useMemo } from 'react';
import ConnectionScreen from './components/ConnectionScreen';
import VideoPlayer from './components/VideoPlayer';
import ChannelList from './components/ChannelList';
import ToastContainer from './components/ToastContainer';
import { useToast } from './hooks/useToast';
import { Channel, SavedConnection, SourceInfo, PlayMode, ViewMode, KindFilter } from './types';
import { sortWithBeinPriority } from './lib/m3uParser';
import { saveChannelsCache, loadChannelsCache, clearChannelsCache, saveLastChannel, getLastChannelId, getLocalFavs, saveLocalFavs } from './lib/storage';
import { useProxy } from './lib/playerEngine';

function App() {
  const [screen, setScreen] = useState<'connect' | 'main'>('connect');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selKind, setSelKind] = useState<KindFilter>('live');
  const [selGroup, setSelGroup] = useState<string>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [playerOpen, setPlayerOpen] = useState(true);
  const [playMode, setPlayMode] = useState<PlayMode>('auto');
  const [loading, setLoading] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [savedConns, setSavedConns] = useState<SavedConnection[]>([]);
  const { toasts, toast } = useToast();

  // Load saved connections from API
  useEffect(() => {
    fetch('/api/saved-connections')
      .then(r => r.json())
      .then(setSavedConns)
      .catch(() => {});
  }, []);

  // Try auto-restore from cache on mount
  useEffect(() => {
    loadChannelsCache().then(cache => {
      if (!cache?.channels?.length) return;
      setChannels(cache.channels);
      setSource(cache.source);
      setScreen('main');
      const lastId = getLastChannelId();
      if (lastId) {
        const ch = cache.channels.find((c: Channel) => c.id === lastId);
        if (ch) setCurrentChannel(ch);
      }
      refreshChannelsSilently(cache.source);
    }).catch(console.warn);
  }, []);

  // Compute groups
  const groups: [string, number][] = useMemo(() => {
    const kindChannels = channels.filter(ch => ch.kind === selKind);
    const map: Record<string, number> = {};
    kindChannels.forEach(ch => { map[ch.group] = (map[ch.group] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]) as [string, number][];
  }, [channels, selKind]);

  // Compute kind counts
  const kindCounts = useMemo(() => {
    const c = { live: 0, movie: 0, series: 0 };
    channels.forEach(ch => { c[ch.kind]++; });
    return c;
  }, [channels]);

  // Filtered channels
  const filtered = useMemo(() => {
    let list = channels.filter(ch => ch.kind === selKind);
    if (selGroup === '__fav__') {
      const favs = getLocalFavs();
      list = list.filter(ch => favs.has(ch.id));
    } else if (selGroup !== 'all') {
      list = list.filter(ch => ch.group === selGroup);
    }
    if (favOnly && selGroup !== '__fav__') {
      const favs = getLocalFavs();
      list = list.filter(ch => favs.has(ch.id));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(ch => ch.name.toLowerCase().includes(q) || ch.group.toLowerCase().includes(q));
    }
    return sortWithBeinPriority(list);
  }, [channels, selKind, selGroup, favOnly, search]);

  const handleConnect = useCallback(async (newChannels: Channel[], newSource: SourceInfo) => {
    setLoading(true);
    try {
      setChannels(newChannels);
      setSource(newSource);
      await saveChannelsCache(newChannels, newSource);
      // Save connection to API
      try {
        await fetch('/api/saved-connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSource.type === 'xtream' ? {
            type: newSource.type, name: newSource.name,
            server: newSource.server, user: newSource.user, pass: newSource.pass,
          } : { type: newSource.type, name: newSource.name, url: newSource.url }),
        });
        const resp = await fetch('/api/saved-connections');
        setSavedConns(await resp.json());
      } catch (e) { console.warn('Failed to save connection:', e); }

      // Auto-select kind if no live channels
      const counts = { live: 0, movie: 0, series: 0 };
      newChannels.forEach(ch => { counts[ch.kind]++; });
      if (counts.live === 0 && (counts.movie > 0 || counts.series > 0)) {
        setSelKind(counts.movie > 0 ? 'movie' : 'series');
      }
      setScreen('main');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDeleteSaved = useCallback(async (id: number) => {
    try {
      await fetch('/api/saved-connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSavedConns(prev => prev.filter(s => s.id !== id));
    } catch (e) { console.warn('Failed to delete:', e); }
  }, []);

  const handlePlayChannel = useCallback((ch: Channel) => {
    setCurrentChannel(ch);
    saveLastChannel(ch.id);
  }, []);

  const handleToggleFav = useCallback((_id: string) => {
    const favs = getLocalFavs();
    if (favs.has(_id)) favs.delete(_id); else favs.add(_id);
    saveLocalFavs(favs);
    // Force re-render by updating channels reference
    setChannels(prev => [...prev]);
  }, []);

  const handleNavChannel = useCallback((dir: number) => {
    if (!filtered.length) return;
    let idx = currentChannel ? filtered.findIndex(c => c.id === currentChannel.id) : -1;
    idx += dir;
    if (idx < 0) idx = filtered.length - 1;
    if (idx >= filtered.length) idx = 0;
    handlePlayChannel(filtered[idx]);
  }, [filtered, currentChannel, handlePlayChannel]);

  const handleDisconnect = useCallback(() => {
    setCurrentChannel(null);
    setChannels([]);
    setSearch('');
    setSelGroup('all');
    setSelKind('live');
    setFavOnly(false);
    clearChannelsCache();
    setScreen('connect');
  }, []);

  const handleToggleSide = useCallback((open?: boolean) => {
    setSideOpen(prev => open !== undefined ? open : !prev);
  }, []);

  // Silent refresh in background
  const refreshChannelsSilently = useCallback(async (src: SourceInfo | null) => {
    if (!src) src = source;
    if (!src || src.type === 'm3u-file') return;
    try {
      if (src.type === 'm3u-url' && src.url) {
        const resp = await fetch(useProxy(src.url), { cache: 'no-store' });
        if (!resp.ok) return;
        const text = await resp.text();
        if (!text.includes('#EXTM3U')) return;
        const fresh: Channel[] = [];
        const { parseM3uProgressive } = await import('./lib/m3uParser');
        await parseM3uProgressive(text, ch => fresh.push(ch), () => {});
        if (fresh.length) {
          setChannels(fresh);
          await saveChannelsCache(fresh, src);
        }
      }
    } catch (e) {
      console.warn('[Refresh] فشل التحديث الصامت:', e);
    }
  }, [source]);

  // Global keyboard shortcuts for channel navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); handleNavChannel(1); break;
        case 'ArrowLeft': e.preventDefault(); handleNavChannel(-1); break;
        case 'Escape': if (document.fullscreenElement) document.exitFullscreen(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNavChannel]);

  return (
    <div 
      className="font-[Tajawal,sans-serif] bg-[#09090b] text-[#fafafa] h-screen h-[100dvh] overflow-hidden w-full max-w-[100vw] overscroll-behavior-x-none fixed inset-0" 
      dir="rtl"
      style={{ fontFamily: "'Tajawal', sans-serif" }}
    >
      {/* Google Fonts for Arabic */}
      <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;900&display=swap" rel="stylesheet" />
      
      {/* HLS.js CDN */}
      <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js" async />
      
      {/* mpegts.js CDN */}
      <script src="https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js" async />

      {screen === 'connect' ? (
        <ConnectionScreen
          onConnect={handleConnect}
          savedConnections={savedConns}
          onDeleteSaved={handleDeleteSaved}
          loading={loading}
        />
      ) : (
        <>
          {/* Side backdrop for mobile */}
          <div
            className={`fixed inset-0 bg-black/65 backdrop-blur-[1px] transition-opacity duration-250 z-[998] lg:hidden ${sideOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onClick={() => handleToggleSide(false)}
            aria-hidden="true"
          />

          <div className="flex h-full overflow-hidden">
            <ChannelList
              channels={channels}
              filtered={filtered}
              currentChannel={currentChannel}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              selKind={selKind}
              onKindChange={setSelKind}
              selGroup={selGroup}
              onGroupChange={setSelGroup}
              groups={groups}
              favOnly={favOnly}
              onFavOnlyToggle={() => setFavOnly(p => !p)}
              search={search}
              onSearchChange={setSearch}
              onPlayChannel={handlePlayChannel}
              onToggleFav={handleToggleFav}
              onNavChannel={handleNavChannel}
              kindCounts={kindCounts}
              isSideOpen={sideOpen}
              onToggleSide={handleToggleSide}
            />
          </div>

          <VideoPlayer
            channel={currentChannel}
            playMode={playMode}
            onPlayModeChange={setPlayMode}
            playerOpen={playerOpen}
            onTogglePlayer={() => setPlayerOpen(p => !p)}
          />

          <ToastContainer toasts={toasts} />
        </>
      )}

      {screen === 'connect' && <ToastContainer toasts={toasts} />}
    </div>
  );
}

export default App;
