import { useRef, useEffect, useCallback, useMemo } from 'react';
import { Tv, Heart, Copy, Search, List, Grid } from 'lucide-react';
import { Channel, ViewMode, KindFilter } from '../types';
import { sortWithBeinPriority, escapeHtml } from '../lib/m3uParser';
import { getLocalFavs, saveLocalFavs } from '../lib/storage';

interface Props {
  channels: Channel[];
  filtered: Channel[];
  currentChannel: Channel | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  selKind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  selGroup: string;
  onGroupChange: (group: string) => void;
  groups: [string, number][];
  favOnly: boolean;
  onFavOnlyToggle: () => void;
  search: string;
  onSearchChange: (q: string) => void;
  onPlayChannel: (ch: Channel) => void;
  onToggleFav: (id: string) => void;
  onNavChannel: (dir: number) => void;
  kindCounts: { live: number; movie: number; series: number };
  isSideOpen: boolean;
  onToggleSide: (open?: boolean) => void;
}

const ITEM_H = 58;
const BUFFER = 12;

export default function ChannelList({
  channels, filtered, currentChannel, viewMode, onViewModeChange,
  selKind, onKindChange, selGroup, onGroupChange, groups, favOnly, onFavOnlyToggle,
  search, onSearchChange, onPlayChannel, onToggleFav, onNavChannel, kindCounts, isSideOpen, onToggleSide
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const favs = useMemo(() => getLocalFavs(), [filtered.length]);
  const scrollTick = useRef(false);

  // Virtual scrolling for list view
  const renderVisible = useCallback(() => {
    if (viewMode !== 'grid' || !listRef.current || !containerRef.current) return;
    const st = containerRef.current.scrollTop;
    const vh = containerRef.current.clientHeight;
    const start = Math.max(0, Math.floor(st / ITEM_H) - BUFFER);
    const end = Math.min(filtered.length, Math.ceil((st + vh) / ITEM_H) + BUFFER);
    // Render is handled by React state, this triggers re-render
  }, [filtered.length, viewMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      if (viewMode !== 'list' || scrollTick.current) return;
      scrollTick.current = true;
      requestAnimationFrame(() => { scrollTick.current = false; });
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, [viewMode]);

  // Keyboard navigation for Smart TV
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIdx(prev => Math.min(filtered.length - 1, prev + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIdx(prev => Math.max(0, prev - 1));
          break;
        case 'Enter':
        case 'Space':
          e.preventDefault();
          if (focusedIdx >= 0 && focusedIdx < filtered.length) onPlayChannel(filtered[focusedIdx]);
          break;
        case 'ArrowRight':
          e.preventDefault(); onNavChannel(1); break;
        case 'ArrowLeft':
          e.preventDefault(); onNavChannel(-1); break;
        case 'KeyF':
          // fullscreen handled by player
          break;
        case 'KeyS':
          e.preventDefault(); searchInputRef.current?.focus(); break;
        case 'Escape':
          if (document.fullscreenElement) document.exitFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, focusedIdx, onPlayChannel, onNavChannel]);

  const kindButtons: { key: KindFilter; label: string; icon: typeof Tv }[] = [
    { key: 'live', label: 'قنوات', icon: Tv },
    { key: 'movie', label: 'أفلام', icon: Tv },
    { key: 'series', label: 'مسلسلات', icon: Tv },
  ];

  const kindChannels = channels.filter(ch => ch.kind === selKind);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside className={`w-[210px] lg:w-[240px] bg-[#111114] border-l border-[#2a2a2e] flex flex-col flex-shrink-0 overflow-hidden transition-transform duration-280 ease-[cubic-bezier(.4,0,.2,1)] fixed lg:relative right-0 top-0 h-full h-[100dvh] z-[999] ${isSideOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'} shadow-[-12px_0_40px_rgba(0,0,0,.5)] lg:shadow-none`}>
        {/* Kind tabs */}
        <div className="flex flex-col gap-[2px] p-2 border-b border-[#2a2a2e] flex-shrink-0">
          {kindButtons.map(kb => (
            <button
              key={kb.key}
              onClick={() => { onKindChange(kb.key); onGroupChange('all'); onFavOnlyToggle(); if (window.innerWidth <= 860) onToggleSide(false); }}
              className={`flex items-center gap-2 px-2.5 py-2 border-none bg-transparent text-[12px] font-medium rounded-lg cursor-pointer transition-colors w-full text-right ${selKind === kb.key ? 'bg-[rgba(245,158,11,.15)] text-[#f59e0b]' : 'text-[#a1a1aa] hover:bg-[#18181b] hover:text-[#fafafa]'}`}
            >
              <kb.icon size={12} className="w-3.5 text-center" />
              <span>{kb.label}</span>
              <span className={`mr-auto text-[10px] px-1.5 py-[1px] rounded-[7px] min-w-[22px] text-center ${selKind === kb.key ? 'bg-[rgba(245,158,11,.2)] text-[#f59e0b]' : 'bg-[#27272a] text-[#a1a1aa]'}`}>
                {kindCounts[kb.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Groups header */}
        <div className="px-3.5 py-3 text-[11px] font-bold text-[#52525b] tracking-wider border-b border-[#2a2a2e] flex items-center justify-between flex-shrink-0">
          <span>التصنيفات</span>
          <span className="bg-[#27272a] px-1.5 py-[1px] rounded-[9px] text-[10px] text-[#a1a1aa]">{groups.length}</span>
        </div>

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto p-1.5">
          <div
            onClick={() => { onGroupChange('all'); if (window.innerWidth <= 860) onToggleSide(false); }}
            className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-colors text-[12.5px] ${selGroup === 'all' ? 'bg-[rgba(245,158,11,.15)] text-[#f59e0b] font-medium' : 'text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa]'}`}
          >
            <span>الكل</span>
            <span className={`text-[10px] bg-[#18181b] px-1.5 py-[1px] rounded-[7px] min-w-[26px] text-center ${selGroup === 'all' ? 'bg-[rgba(245,158,11,.2)]' : ''}`}>{kindChannels.length}</span>
          </div>
          <div
            onClick={() => { onGroupChange('__fav__'); if (window.innerWidth <= 860) onToggleSide(false); }}
            className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-colors text-[12.5px] ${selGroup === '__fav__' ? 'bg-[rgba(245,158,11,.15)] text-[#f59e0b] font-medium' : 'text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa]'}`}
          >
            <span className="flex items-center gap-1.5"><Heart size={11} className="text-[#ef4444] ml-1.5" /> المفضلة</span>
            <span className="text-[10px] bg-[#18181b] px-1.5 py-[1px] rounded-[7px] min-w-[26px] text-center">{favs.size}</span>
          </div>
          {groups.map(([name, cnt]) => (
            <div
              key={name}
              onClick={() => { onGroupChange(name); if (window.innerWidth <= 860) onToggleSide(false); }}
              className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-colors text-[12.5px] mb-[1px] ${selGroup === name ? 'bg-[rgba(245,158,11,.15)] text-[#f59e0b] font-medium' : 'text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa]'}`}
            >
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{escapeHtml(name)}</span>
              <span className={`text-[10px] bg-[#18181b] px-1.5 py-[1px] rounded-[7px] min-w-[26px] text-center flex-shrink-0 ${selGroup === name ? 'bg-[rgba(245,158,11,.2)]' : ''}`}>{cnt}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <header className="flex items-center gap-3.5 px-4 md:px-[18px] py-2 bg-[#111114] border-b border-[#2a2a2e] flex-shrink-0 shadow-[0_2px_12px_rgba(0,0,0,.25)] relative z-10">
          <button onClick={() => onToggleSide()} className="lg:hidden bg-[#18181b] border border-[#2a2a2e] text-[#a1a1aa] px-2.5 py-2 rounded-lg cursor-pointer text-[11.5px] flex items-center gap-1.5 transition-colors hover:border-[#f59e0b] hover:text-[#f59e0b]">
            <Tv size={13} />
          </button>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-[30px] h-[30px] bg-gradient-to-br from-[#f59e0b] to-[#d97706] rounded-lg flex items-center justify-center text-[13px] text-black">
              <Play size={13} />
            </div>
            <span className="font-bold text-[15px] hidden sm:block">IPTV Pro</span>
          </div>

          <div className="flex-1 max-w-[380px] relative mx-auto">
            <Search size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52525b]" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="ابحث عن قناة..."
              className="w-full px-3 py-1.5 pl-9 pr-8 bg-[#18181b] border border-[#2a2a2e] rounded-lg text-[#fafafa] text-[12.5px] outline-none transition-colors focus:border-[#f59e0b] ltr text-left"
              dir="ltr"
            />
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={onFavOnlyToggle} className={`bg-[#18181b] border border-[#2a2a2e] px-2.5 py-2 rounded-lg cursor-pointer text-[11.5px] flex items-center gap-1.5 transition-colors whitespace-nowrap ${favOnly ? 'border-[#ef4444] text-[#ef4444]' : 'text-[#a1a1aa] hover:border-[#f59e0b] hover:text-[#f59e0b]'}`}>
              <Heart size={12} />
              <span className="hidden sm:inline">المفضلة</span>
            </button>
          </div>
        </header>

        {/* Channels header */}
        <div className="flex items-center justify-between px-4 md:px-[18px] py-2.5 border-b border-[#2a2a2e] flex-shrink-0">
          <div className="text-[12.5px] text-[#a1a1aa]">
            القنوات <strong className="text-[#f59e0b]">{filtered.length}</strong>
          </div>
          <div className="flex gap-[3px]">
            {[{ mode: 'list' as ViewMode, icon: List }, { mode: 'grid' as ViewMode, icon: Grid }].map(v => (
              <button
                key={v.mode}
                onClick={() => onViewModeChange(v.mode)}
                className={`bg-[#18181b] border text-[#52525b] px-2.5 py-1 rounded-lg cursor-pointer text-[11px] transition-colors ${viewMode === v.mode ? 'border-[#f59e0b] text-[#f59e0b]' : 'border-[#2a2a2e] hover:border-[#f59e0b] hover:text-[#f59e0b]'}`}
              >
                <v.icon size={12} />
              </button>
            ))}
          </div>
        </div>

        {/* Channel list container */}
        <div ref={containerRef} className="flex-1 overflow-y-auto relative">
          {viewMode === 'list' ? (
            <div ref={listRef} style={{ height: filtered.length * ITEM_H + 'px' }}>
              {filtered.slice(0, 200).map((ch, i) => {
                const playing = currentChannel?.id === ch.id;
                const isFav = favs.has(ch.id);
                return (
                  <div
                    key={ch.id}
                    onClick={() => onPlayChannel(ch)}
                    className={`flex items-center gap-3 px-4 md:px-[18px] cursor-pointer transition-colors border-b border-white/[.025] absolute w-full ${playing ? 'bg-[rgba(245,158,11,.1)] border-r-[3px] border-r-[#f59e0b]' : 'hover:bg-[#27272a]'}`}
                    style={{ top: i * ITEM_H, height: ITEM_H + 'px' }}
                    data-index={i}
                  >
                    <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden bg-[#18181b]">
                      {ch.logo ? (
                        <img src={ch.logo} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { const target = e.target as HTMLImageElement; target.parentElement!.innerHTML = `<span class="text-[#52525b]"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg></span>`; }} />
                      ) : (
                        <span className="text-[#52525b]"><Tv size={15} /></span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{escapeHtml(ch.name)}</div>
                      <div className="text-[10.5px] text-[#52525b] mt-0.5">{escapeHtml(ch.group)}</div>
                      <div className="text-[9.5px] text-[#52525b] mt-0.5 ltr text-right whitespace-nowrap overflow-hidden text-ellipsis opacity-50" dir="ltr">{escapeHtml(ch.url)}</div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity flex-shrink-0 group-hover:opacity-100" style={{}} onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')} onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}>
                      <button onClick={e => { e.stopPropagation(); onToggleFav(ch.id); }} className={`bg-transparent border-0 text-[#52525b] p-1 rounded cursor-pointer text-[12px] transition-colors hover:text-[#f59e0b] hover:bg-[rgba(245,158,11,.1)] ${isFav ? 'text-[#ef4444]' : ''}`} title="مفضلة">
                        <Heart size={12} className={isFav ? 'fill-current' : ''} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(ch.url).then(() => {}); }} className="bg-transparent border-0 text-[#52525b] p-1 rounded cursor-pointer text-[12px] transition-colors hover:text-[#f59e0b] hover:bg-[rgba(245,158,11,.1)]" title="نسخ الرابط">
                        <Copy size={12} />
                      </button>
                    </div>
                    {playing && (
                      <div className="flex items-end gap-[2px] h-[13px] flex-shrink-0">
                        {[40, 70, 50, 90].map((h, j) => (
                          <span key={j} className="w-[3px] bg-[#f59e0b] rounded-sm animate-eq" style={{ height: h + '%', animationDelay: j * 0.15 + 's' }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Grid view */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 p-3.5 md:p-[14px]">
              {filtered.map((ch, i) => {
                const playing = currentChannel?.id === ch.id;
                return (
                  <div
                    key={ch.id}
                    onClick={() => onPlayChannel(ch)}
                    className={`flex flex-col items-center p-2.5 text-center border border-transparent rounded-xl cursor-pointer transition-colors ${playing ? 'border-[#f59e0b] bg-[rgba(245,158,11,.1)]' : 'hover:border-[#2a2a2e] hover:bg-[#18181b]'}`}
                  >
                    <div className="w-12 h-12 mb-1.5 rounded-lg flex items-center justify-center overflow-hidden bg-[#18181b]">
                      {ch.logo ? (
                        <img src={ch.logo} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { const target = e.target as HTMLImageElement; target.parentElement!.innerHTML = `<span class="text-[#52525b]"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg></span>`; }} />
                      ) : (
                        <span className="text-[#52525b]"><Tv size={20} /></span>
                      )}
                    </div>
                    <div className="text-[11px] font-medium whitespace-normal leading-tight">{escapeHtml(ch.name)}</div>
                    {playing && (
                      <div className="flex items-end gap-[2px] h-[13px] justify-center mt-1">
                        {[40, 70, 50, 90].map((h, j) => (
                          <span key={j} className="w-[3px] bg-[#f59e0b] rounded-sm animate-eq" style={{ height: h + '%', animationDelay: j * 0.15 + 's' }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 md:py-20 text-[#52525b] gap-2.5">
              <Tv size={36} className="opacity-25" />
              <p className="text-[13px]">لا توجد قنوات</p>
            </div>
          )}
        </div>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes eq { 0%,100%{transform:scaleY(1)}50%{transform:scaleY(.3)} }
        .animate-eq { animation: eq .8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// Need useState for focusedIdx
import { useState } from 'react';
import { Play } from 'lucide-react';
