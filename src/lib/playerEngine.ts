// @ts-ignore - hls.js global
declare const Hls: any;
// @ts-ignore - mpegts.js global
declare const mpegts: any;

import { Channel, PlayMode } from '../types';
import { detectStreamKind } from './m3uParser';

const PROXY_BASE = '/api/proxy?url=';

export function useProxy(url: string): string {
  if (!url) return '';
  if (url.startsWith(PROXY_BASE) || url.startsWith('/api/')) return url;
  return PROXY_BASE + encodeURIComponent(url);
}

export interface RetryState {
  generation: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setInterval> | null;
  lastTime: number;
  lastProgressTs: number;
  active: boolean;
}

export function createRetryState(): RetryState {
  return {
    generation: 0,
    attempts: 0,
    timer: null,
    watchdog: null,
    lastTime: -1,
    lastProgressTs: Date.now(),
    active: false,
  };
}

export function backoffDelay(attempts: number): number {
  return Math.min(1000 * Math.pow(1.6, Math.min(attempts, 9)), 15000);
}

export function stopPlayback(
  videoEl: HTMLVideoElement,
  R: RetryState,
  hlsRef: React.MutableRefObject<any>,
  mpegtsRef: React.MutableRefObject<any>,
  fullyStop: boolean = true
): void {
  if (fullyStop) {
    R.generation++;
    R.attempts = 0;
    R.active = false;
    if (R.timer) { clearTimeout(R.timer); R.timer = null; }
    if (R.watchdog) { clearInterval(R.watchdog); R.watchdog = null; }
  }
  if (hlsRef.current) {
    try { hlsRef.current.destroy(); } catch (e) {}
    hlsRef.current = null;
  }
  if (mpegtsRef.current) {
    try {
      mpegtsRef.current.pause();
      mpegtsRef.current.unload();
      mpegtsRef.current.detachMediaElement();
      mpegtsRef.current.destroy();
    } catch (e) {}
    mpegtsRef.current = null;
  }
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
}

export function attemptPlayback(
  ch: Channel,
  gen: number,
  playMode: PlayMode,
  videoEl: HTMLVideoElement,
  R: RetryState,
  hlsRef: React.MutableRefObject<any>,
  mpegtsRef: React.MutableRefObject<any>,
  onBuffering: (show: boolean) => void,
  onScheduleRetry: (ch: Channel, gen: number, reason: string) => void,
  onStartWatchdog: (ch: Channel, gen: number) => void
): void {
  if (gen !== R.generation) return;

  const originalUrl = ch.url;
  const url = useProxy(originalUrl);
  console.log(`[Player] محاولة تشغيل: ${ch.name} | المحاولة رقم: ${R.attempts}`);

  if (playMode === 'native') {
    playNative(url, videoEl, R, hlsRef, mpegtsRef, ch, gen, onStartWatchdog, true);
    return;
  }

  const kind = detectStreamKind(originalUrl);
  console.log('[Player] نوع البث المكتشف:', kind);

  if (kind === 'hls') {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      playWithHLS(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, true);
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      playNative(url, videoEl, R, hlsRef, mpegtsRef, ch, gen, onStartWatchdog, true);
    } else {
      playWithMpegts(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, true);
    }
  } else if (kind === 'ts') {
    playWithMpegts(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, true);
  } else if (kind === 'direct') {
    playNative(url, videoEl, R, hlsRef, mpegtsRef, ch, gen, onStartWatchdog, true);
  } else {
    // Unknown - try HLS first, then mpegts, then native
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      playWithHLS(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, true);
    } else {
      playWithMpegts(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, true);
    }
  }
}

function playWithHLS(
  url: string, ch: Channel, gen: number,
  videoEl: HTMLVideoElement, R: RetryState,
  hlsRef: React.MutableRefObject<any>, mpegtsRef: React.MutableRefObject<any>,
  onBuffering: (show: boolean) => void,
  onScheduleRetry: (ch: Channel, gen: number, reason: string) => void,
  onStartWatchdog: (ch: Channel, gen: number) => void,
  tryNext: boolean
): void {
  if (gen !== R.generation) return;
  try {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      startFragPrefetch: true,
      liveSyncDurationCount: 3,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      startLevel: -1,
      fragLoadingTimeOut: 30000,
      fragLoadingMaxRetry: Infinity,
      fragLoadingRetryDelay: 1000,
      fragLoadingMaxRetryTimeout: 15000,
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: Infinity,
      manifestLoadingRetryDelay: 1000,
      levelLoadingTimeOut: 20000,
      levelLoadingMaxRetry: Infinity,
      levelLoadingRetryDelay: 1000,
      recoverMediaErrorMaxRetry: Infinity,
      xhrSetup: (xhr: XMLHttpRequest) => {
        xhr.withCredentials = false;
      },
    });

    hls.loadSource(url);
    hls.attachMedia(videoEl);

    hls.on(Hls.Events.MANIFEST_PARSED, (_event: any, _data: any) => {
      if (gen !== R.generation) return;
      console.log(`[HLS] تم تحليل الملف، المستويات: ${_data.levels?.length || 0}`);
      videoEl.play().catch(() => {});
    });

    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      if (gen !== R.generation) return;
      onBuffering(false);
      R.attempts = 0;
    });

    hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
      if (gen !== R.generation) return;
      console.warn(`[HLS] خطأ: ${data.type} ${data.details}${data.fatal ? ' FATAL' : ''}`);

      if (data.details === 'manifestLoadError' || data.details === 'manifestParsingError') {
        console.log('[HLS] فشل تحميل الملف، جاري تجربة mpegts.js...');
        try { hls.destroy(); } catch (e) {}
        if (hlsRef.current === hls) hlsRef.current = null;
        if (tryNext) playWithMpegts(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, false);
        else onScheduleRetry(ch, gen, 'manifest error');
        return;
      }

      if (!data.fatal) return;

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        onBuffering(true);
        setTimeout(() => {
          if (gen !== R.generation || hlsRef.current !== hls) return;
          try { hls.startLoad(); } catch (e) { onScheduleRetry(ch, gen, 'network retry failed'); }
        }, 800);
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        onBuffering(true);
        try { hls.recoverMediaError(); } catch (e) { onScheduleRetry(ch, gen, 'media recover failed'); }
      } else {
        try { hls.destroy(); } catch (e) {}
        if (hlsRef.current === hls) hlsRef.current = null;
        if (tryNext) {
          console.log('[Player] خطأ قاتل، جاري تجربة mpegts.js...');
          playWithMpegts(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, false);
        } else {
          onScheduleRetry(ch, gen, 'hls fatal unrecoverable');
        }
      }
    });

    hlsRef.current = hls;
    onStartWatchdog(ch, gen);
  } catch (e) {
    console.error('[HLS] استثناء:', e);
    if (tryNext) playWithMpegts(url, ch, gen, videoEl, R, hlsRef, mpegtsRef, onBuffering, onScheduleRetry, onStartWatchdog, false);
    else onScheduleRetry(ch, gen, 'hls exception');
  }
}

function playWithMpegts(
  url: string, ch: Channel, gen: number,
  videoEl: HTMLVideoElement, R: RetryState,
  hlsRef: React.MutableRefObject<any>, mpegtsRef: React.MutableRefObject<any>,
  onBuffering: (show: boolean) => void,
  onScheduleRetry: (ch: Channel, gen: number, reason: string) => void,
  onStartWatchdog: (ch: Channel, gen: number) => void,
  tryNext: boolean
): void {
  if (gen !== R.generation) return;
  if (typeof mpegts === 'undefined' || !mpegts.getFeatureList().mseLivePlayback) {
    console.warn('[mpegts.js] غير مدعوم في هذا المتصفح');
    if (tryNext) playNative(url, videoEl, R, hlsRef, mpegtsRef, ch, gen, onStartWatchdog, false);
    else onScheduleRetry(ch, gen, 'mpegts unsupported');
    return;
  }
  try {
    const player = mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url, cors: true, withCredentials: false },
      {
        enableWorker: true,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 6,
        liveBufferLatencyMinRemain: 1,
        fixAudioTimestampGap: true,
        autoCleanupSourceBuffer: true,
      }
    );
    player.attachMediaElement(videoEl);
    player.load();
    player.on(mpegts.Events.ERROR, (_type: any, _detail: any, _info: any) => {
      if (gen !== R.generation) return;
      console.warn(`[mpegts.js] خطأ: ${_type} ${_detail}`);
      try { player.destroy(); } catch (e) {}
      if (mpegtsRef.current === player) mpegtsRef.current = null;
      if (tryNext) {
        console.log('[Player] فشل، جاري تجربة التشغيل المباشر...');
        playNative(url, videoEl, R, hlsRef, mpegtsRef, ch, gen, onStartWatchdog, false);
      } else {
        onScheduleRetry(ch, gen, 'mpegts error: ' + _type);
      }
    });
    player.play().catch(() => {});
    mpegtsRef.current = player;
    onStartWatchdog(ch, gen);
  } catch (e) {
    console.error('[mpegts.js] استثناء:', e);
    if (tryNext) playNative(url, videoEl, R, hlsRef, mpegtsRef, ch, gen, onStartWatchdog, false);
    else onScheduleRetry(ch, gen, 'mpegts exception');
  }
}

function playNative(
  url: string,
  videoEl: HTMLVideoElement,
  R: RetryState,
  _hlsRef: React.MutableRefObject<any>,
  _mpegtsRef: React.MutableRefObject<any>,
  ch: Channel, gen: number,
  onStartWatchdog: (ch: Channel, gen: number) => void,
  _isLast: boolean
): void {
  if (gen !== R.generation) return;
  console.log('[Native] تشغيل مباشر:', url.substring(0, 100));
  videoEl.src = url;
  videoEl.load();
  videoEl.play().catch(() => {});
  onStartWatchdog(ch, gen);
}

export function startWatchdog(
  ch: Channel, gen: number,
  videoEl: HTMLVideoElement,
  R: RetryState,
  hlsRef: React.MutableRefObject<any>,
  onBuffering: (show: boolean) => void,
  onScheduleRetry: (ch: Channel, gen: number, reason: string) => void
): void {
  if (R.watchdog) clearInterval(R.watchdog);
  R.lastTime = -1;
  R.lastProgressTs = Date.now();

  R.watchdog = setInterval(() => {
    if (gen !== R.generation) { clearInterval(R.watchdog!); R.watchdog = null; return; }
    if (videoEl.paused || videoEl.seeking) { R.lastProgressTs = Date.now(); return; }
    const ct = videoEl.currentTime;
    if (ct !== R.lastTime) {
      R.lastTime = ct;
      R.lastProgressTs = Date.now();
      return;
    }
    const frozenFor = Date.now() - R.lastProgressTs;
    if (frozenFor > 4000) {
      R.lastProgressTs = Date.now();
      console.warn('[Watchdog] تجمد البث — إعادة اتصال إجبارية');
      onBuffering(true);
      if (hlsRef.current) {
        try { hlsRef.current.startLoad(videoEl.currentTime); return; } catch (e) {}
      }
      onScheduleRetry(ch, gen, 'watchdog stall');
    }
  }, 2000);
}
