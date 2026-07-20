export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  type: string;
  kind: 'live' | 'movie' | 'series';
  tvgId?: string;
  streamId?: number;
}

export interface SavedConnection {
  id?: number;
  type: 'm3u-url' | 'm3u-file' | 'xtream';
  name: string;
  url?: string;
  server?: string;
  user?: string;
  pass?: string;
  created_at?: string;
}

export interface Favorite {
  id?: number;
  channel_id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

export interface SourceInfo {
  type: 'm3u-url' | 'm3u-file' | 'xtream';
  url?: string;
  name?: string;
  server?: string;
  user?: string;
  pass?: string;
}

export type PlayMode = 'auto' | 'hls' | 'mpegts' | 'native';
export type ViewMode = 'list' | 'grid';
export type KindFilter = 'live' | 'movie' | 'series';
