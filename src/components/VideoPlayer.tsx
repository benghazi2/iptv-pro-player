import { useRef, useEffect, useCallback, useState } from 'react';
import { ChevronDown, ChevronUp, Volume2, VolumeX, Volume1, Pause, Play, Maximize, SkipBack, SkipForward, Bolt, PlayCircle, SatelliteDish } from 'lucide-react';
import { Channel, PlayMode } from '../types';
import { createRetryState, stopPlayback, attemptPlayback, startWatchdog, useProxy } from '../lib/playerEngine';
import type { RetryState } from '../lib/playerEngine';

interface Props {
  channel: Channel | null;
  playMode: PlayMode;
  onPlayModeChange: (mode: PlayMode) => void;
  playerOpen: boolean;
  onTogglePlayer: () => void;
}

export default function VideoPlayer({ channel, playMode, onPlayModeChange, playerOpen, onTogglePlayer }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const mpegtsRef = useRef<any>(null);
  const RRef = useRef<RetryState>(createRetryState());
  const [buffering, setBuffering] = useState(false);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  const showBufOverlay = useCallback((show: boolean) => setBuffering(show), []);
  const scheduleRetry = useCallback((ch: Channel, gen: number, reason: string) => {
    const R = RRef.current;
    if (gen !== R.generation) return;
    R.attempts++;
    const delay = (1000 * Math.pow(1.6, Math.min(R.attempts, 9)), 15000);
    showBufOverlay(true);
    console.log(`[Reconnect] ${reason} — إعادة محاولة كاملة خلال ${delay}ms (#${R.attempts})`);
    if (R.timer) clearTimeout(R.timer);
    R.timer = setTimeout(() => {
      if (gen !== R.generation) return;
      if (videoRef.current) attemptPlayback(ch, gen, playMode, videoRef.current, R, hlsRef, mpegtsRef, showBufOverlay, scheduleRetry, startWatchdogCb);
    }, delay);
  }, [playMode]);

  const startWatchdogCb = useCallback((ch: Channel, gen: number) => {
    if (videoRef.current) startWatchdog(ch, gen, videoRef.current, RRef.current, hlsRef, showBufOverlay, scheduleRetry);
  }, [scheduleRetry]);

  // Play channel when it changes
  useEffect(() => {
    if (!channel || !videoRef.current) return;
    const vid = videoRef.current;
    const R = RRef.current;
    const gen = ++R.generation;
    R.attempts = 0;
    R.active = true;
    if (R.timer) { clearTimeout(R.timer); R.timer = null; }
    if (R.watchdog) { clearInterval(R.watchdog); R.watchdog = null; }
    showBufOverlay(false);

    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch (e) {} hlsRef.current = null; }
    if (mpegtsRef.current) { try { mpegtsRef.current.pause(); mpegtsRef.current.unload(); mpegtsRef.current.detachMediaElement(); mpegtsRef.current.destroy(); } catch (e) {} mpegtsRef.current = null; }
    vid.pause(); vid.removeAttribute('src'); vid.load();

    attemptPlayback(channel, gen, playMode, vid, R, hlsRef, mpegtsRef, showBufOverlay, scheduleRetry, startWatchdogCb);
    if (!playerOpen) onTogglePlayer();
  }, [channel, playMode, playerOpen, onTogglePlayer, showBufOverlay, scheduleRetry, startWatchdogCb]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current) stopPlayback(videoRef.current, RRef.current, hlsRef, mpegtsRef, true);
    };
  }, []);

  // Video event listeners
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onWaiting = () => { if (RRef.current.active) setBuffering(true); };
    const onPlaying = () => { setBuffering(false); setIsPlaying(true); };
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      const err = vid.error;
      if (!channel || !err || !RRef.current.active) return;
      const msgs: Record<number, string> = { 1: 'الصيغة غير مدعومة', 2: 'خطأ في الشبكة', 3: 'فك التشفير', 4: 'خطأ في الشبكة أو المحتوى غير متوفر' };
      scheduleRetry(channel, RRef.current.generation, 'video element error: ' + (msgs[err.code] || err.code));
    };
    vid.addEventListener('waiting', onWaiting);
    vid.addEventListener('playing', onPlaying);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('error', onError);
    return () => {
      vid.removeEventListener('waiting', onWaiting);
      vid.removeEventListener('playing', onPlaying);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('error', onError);
    };
  }, [channel, scheduleRetry]);

  // Online reconnect
  useEffect(() => {
    const handleOnline = () => {
      if (channel && RRef.current.active) {
        RRef.current.attempts = 0;
        if (videoRef.current) attemptPlayback(channel, RRef.current.generation, playMode, videoRef.current, RRef.current, hlsRef, mpegtsRef, showBufOverlay, scheduleRetry, startWatchdogCb);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [channel, playMode, showBufOverlay, scheduleRetry, startWatchdogCb]);

  // Visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && channel && RRef.current.active && videoRef.current) {
        const vid = videoRef.current;
        if (vid.paused) vid.play().catch(() => {});
        const frozenFor = Date.now() - RRef.current.lastProgressTs;
        if (frozenFor > 8000) {
          RRef.current.attempts = 0;
          attemptPlayback(channel, RRef.current.generation, playMode, vid, RRef.current, hlsRef, mpegtsRef, showBufOverlay, scheduleRetry, startWatchdogCb);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [channel, playMode, showBufOverlay, scheduleRetry, startWatchdogCb]);

  const handleVolChange = (v: number) => {
    if (videoRef.current) videoRef.current.volume = v / 100;
    setVolume(v);
    if (muted && v > 0) setMuted(false);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !muted;
      setMuted(!muted);
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  };

  const VolIconComponent = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const handleFullscreen = () => {
    const el = videoRef.current?.parentElement;
    if (el?.requestFullscreen) el.requestFullscreen();
    else if ((el as any)?.webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => setShowControls(false), 3000);
  };

  return (
    <div
      className={`bg-black relative flex-shrink-0 overflow-hidden transition-all duration-300 ease-out ${playerOpen ? 'min-h-[45vh] min-h-[360px]' : 'h-0'}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
    >
      <video
        ref={videoRef}
        playsInline
        className="w-full h-full block object-contain bg-black"
      />

      {/* Placeholder */}
      {!channel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-[#52525b] gap-2.5 pointer-events-none">
          <SatelliteDish size={44} className="opacity-25" />
          <p className="text-[13px] opacity-40">اختر قناة للتشغيل</p>
        </div>
      )}

      {/* Buffering overlay */}
      <div className={`absolute inset-0 z-[3] ${buffering ? 'flex' : 'hidden'} items-center justify-center bg-[rgba(6,6,8,.42)] backdrop-blur-[3px] transition-opacity duration-150`}>
        <div className="w-10 h-10 rounded-full border-3 border-[rgba(245,158,11,.18)] border-t-[#f59e0b] animate-spin" style={{ borderWidth: '3px' }} />
      </div>

      {/* Controls overlay */}
      <div className={`absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-[rgba(0,0,0,.85)] transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'} flex flex-col justify-end p-4 md:p-[18px]`}>
        {/* Now playing info */}
        {channel && (
          <div className="flex items-center gap-3 mb-3">
            <img src={channel.logo} alt="" className="w-10 h-10 rounded-lg object-cover bg-[#27272a]" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
            <div>
              <h4 className="text-[13px] font-medium">{channel.name}</h4>
              <p className="text-[11px] text-[#a1a1aa]">{channel.group}</p>
            </div>
          </div>
        )}

        {/* Control buttons */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 mr-auto">
            <button onClick={toggleMute} className="bg-transparent border-0 text-white text-[17px] cursor-pointer p-1 rounded transition-opacity hover:opacity-100 hover:bg-white/10 opacity-85">
              <VolIconComponent size={17} />
            </button>
            <input
              type="range" min={0} max={100} value={volume}
              onChange={e => handleVolChange(+e.target.value)}
              className="w-[70px] md:w-[90px] h-[3px] appearance-none bg-white/20 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[11px] [&::-webkit-slider-thumb]:h-[11px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f59e0b] [&::-webkit-slider-thumb]:cursor-pointer"
            />
          </div>
          <button onClick={() => { /* prev - handled by parent via navChannel */ }} className="bg-transparent border-0 text-white text-[17px] cursor-pointer p-1 rounded transition-opacity hover:opacity-100 hover:bg-white/10 opacity-85" title="السابقة">
            <SkipBack size={17} />
          </button>
          <button onClick={togglePlayPause} className="bg-transparent border-0 text-white text-[17px] cursor-pointer p-1 rounded transition-opacity hover:opacity-100 hover:bg-white/10 opacity-85" title="تشغيل/إيقاف">
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button onClick={() => { /* next - handled by parent via navChannel */ }} className="bg-transparent border-0 text-white text-[17px] cursor-pointer p-1 rounded transition-opacity hover:opacity-100 hover:bg-white/10 opacity-85" title="التالية">
            <SkipForward size={17} />
          </button>
          <button onClick={handleFullscreen} className="bg-transparent border-0 text-white text-[17px] cursor-pointer p-1 rounded transition-opacity hover:opacity-100 hover:bg-white/10 opacity-85" title="ملء الشاشة">
            <Maximize size={17} />
          </button>
        </div>
      </div>

      {/* Toggle button */}
      <button onClick={onTogglePlayer} className="absolute top-2 left-2 z-[2] bg-black/60 border-0 text-white w-7 h-7 rounded-md cursor-pointer flex items-center justify-center text-[10px] hover:bg-black/80" title={playerOpen ? 'إخفاء المشغل' : 'إظهار المشغل'}>
        {playerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {/* Mode selector */}
      <div className="absolute top-2 right-2 z-[2] flex gap-1">
        {[{ mode: 'auto' as PlayMode, label: 'تلقائي', icon: Bolt }, { mode: 'native' as PlayMode, label: 'Native', icon: PlayCircle }].map(m => (
          <button
            key={m.mode}
            onClick={() => onPlayModeChange(m.mode)}
            className={`bg-black/60 border-0 text-white px-2 py-1 rounded-md cursor-pointer text-[9px] font-inherit flex items-center gap-1 transition-opacity hover:opacity-100 ${playMode === m.mode ? 'text-[#f59e0b] opacity-100' : 'opacity-70'}`}
            title={m.label}
          >
            <m.icon size={10} />
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
