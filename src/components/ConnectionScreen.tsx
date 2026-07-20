import { useState, useRef, useCallback } from 'react';
import { Play, Link, Upload, Server, History, Trash2, Plug, Loader2 } from 'lucide-react';
import { SavedConnection, SourceInfo, Channel } from '../types';
import { parseM3uProgressive, classifyChannel } from '../lib/m3uParser';
import { useProxy } from '../lib/playerEngine';
import { useToast } from '../hooks/useToast';

interface Props {
  onConnect: (channels: Channel[], source: SourceInfo) => void;
  savedConnections: SavedConnection[];
  onDeleteSaved: (id: number) => void;
  loading: boolean;
}

type TabType = 'm3uurl' | 'm3ufile' | 'xtream';

export default function ConnectionScreen({ onConnect, savedConnections, onDeleteSaved, loading }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('m3uurl');
  const [m3uUrl, setM3uUrl] = useState('');
  const [m3uUrlName, setM3uUrlName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [m3uFileName, setM3uFileName] = useState('');
  const [xtServer, setXtServer] = useState('');
  const [xtUser, setXtUser] = useState('');
  const [xtPass, setXtPass] = useState('');
  const [xtName, setXtName] = useState('');
  const [status, setStatus] = useState<{ html: string; cls: string } | null>(null);
  const [progress, setProgress] = useState(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) setUploadedFile(e.dataTransfer.files[0]);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) setUploadedFile(e.target.files[0]);
  }, []);

  const handleConnect = useCallback(async () => {
    if (loading) return;
    let channels: Channel[] = [];
    let source: SourceInfo;

    try {
      if (activeTab === 'm3uurl') {
        const url = m3uUrl.trim();
        if (!url) throw new Error('أدخل رابط M3U');
        setStatus({ html: '<span class="inline-block w-3.5 h-3.5 border-2 border-[#27272a] border-t-[#f59e0b] rounded-full animate-spin"></span> جاري تحميل الملف...', cls: 'ld' });
        setProgress(0);

        const proxiedUrl = useProxy(url);
        const resp = await fetch(proxiedUrl);
        if (!resp.ok) throw new Error('فشل تحميل الملف HTTP ' + resp.status);
        const text = await resp.text();
        if (!text.includes('#EXTM3U') && !text.includes('#EXTINF')) throw new Error('الملف ليس بصيغة M3U صحيحة');

        await parseM3uProgressive(text, ch => channels.push(ch), (cnt, pct) => {
          setProgress(pct * 100);
          setStatus({ html: `<span class="inline-block w-3.5 h-3.5 border-2 border-[#27272a] border-t-[#f59e0b] rounded-full animate-spin"></span> جاري تحليل ${cnt} قناة`, cls: 'ld' });
        });
        source = { type: 'm3u-url', url, name: m3uUrlName };
      } else if (activeTab === 'm3ufile') {
        if (!uploadedFile) throw new Error('اختر ملف M3U');
        setStatus({ html: '<span class="inline-block w-3.5 h-3.5 border-2 border-[#27272a] border-t-[#f59e0b] rounded-full animate-spin"></span> جاري قراءة الملف...', cls: 'ld' });
        setProgress(0);

        const text = await uploadedFile.text();
        if (!text.includes('#EXTM3U') && !text.includes('#EXTINF')) throw new Error('الملف ليس بصيغة M3U صحيحة');

        await parseM3uProgressive(text, ch => channels.push(ch), (cnt, pct) => {
          setProgress(pct * 100);
          setStatus({ html: `<span class="inline-block w-3.5 h-3.5 border-2 border-[#27272a] border-t-[#f59e0b] rounded-full animate-spin"></span> جاري تحليل ${cnt} قناة`, cls: 'ld' });
        });
        source = { type: 'm3u-file', name: m3uFileName || uploadedFile.name };
      } else {
        const server = xtServer.trim();
        const user = xtUser.trim();
        const pass = xtPass.trim();
        if (!server || !user || !pass) throw new Error('أكمل جميع الحقول');
        setStatus({ html: '<span class="inline-block w-3.5 h-3.5 border-2 border-[#27272a] border-t-[#f59e0b] rounded-full animate-spin"></span> جاري الاتصال بالسيرفر...', cls: 'ld' });
        setProgress(10);

        server.replace(/\/+$/, '');
        let srv = server;
        if (!/^https?:\/\//i.test(srv)) srv = 'http://' + srv;
        const base = `${srv}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;

        const authResp = await fetch(useProxy(base));
        if (!authResp.ok) throw new Error('فشل الاتصال بالسيرفر HTTP ' + authResp.status);
        const authData = await authResp.json();
        if (authData.user_info?.auth === 0) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
        if (authData.user_info?.status === 'disabled') throw new Error('الحساب معطل');

        setProgress(25);
        const [catResp, strResp] = await Promise.all([
          fetch(useProxy(base + '&action=get_live_categories')),
          fetch(useProxy(base + '&action=get_live_streams')),
        ]);
        const categories = await catResp.json();
        const streams = await strResp.json();
        setProgress(60);

        const catMap: Record<number, string> = {};
        categories.forEach((c: any) => catMap[c.category_id] = c.category_name);

        for (let i = 0; i < streams.length; i++) {
          const s = streams[i];
          const xtCh: Channel = {
            id: 'xt_' + s.stream_id,
            name: s.name || 'قناة غير معروفة',
            logo: s.stream_icon || '',
            group: catMap[s.category_id] || 'غير مصنف',
            url: `${srv}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${s.stream_id}.m3u8`,
            streamId: s.stream_id,
            type: 'live',
            kind: 'live',
          };
          classifyChannel(xtCh);
          channels.push(xtCh);
          if (i % 100 === 0) {
            setProgress(60 + (i / streams.length) * 35);
            await new Promise(r => setTimeout(r, 0));
          }
        }
        source = { type: 'xtream', server, user, pass, name: xtName };
      }

      if (!channels.length) throw new Error('لم يتم العثور على قنوات');

      setStatus({ html: `<span>✅</span> تم تحميل ${channels.length} قناة بنجاح`, cls: 'ok' });
      setProgress(100);
      toast(`تم تحميل ${channels.length} قناة بنجاح`, 'success');
      setTimeout(() => onConnect(channels, source), 500);
    } catch (err: any) {
      setStatus({ html: `<span>⚠️</span> ${err.message}`, cls: 'er' });
      setProgress(-1);
      toast(err.message, 'error');
    }
  }, [activeTab, m3uUrl, m3uUrlName, uploadedFile, m3uFileName, xtServer, xtUser, xtPass, xtName, loading, onConnect, toast]);

  const tabs: { key: TabType; label: string; icon: typeof Link }[] = [
    { key: 'm3uurl', label: 'رابط M3U', icon: Link },
    { key: 'm3ufile', label: 'ملف M3U', icon: Upload },
    { key: 'xtream', label: 'Xtream', icon: Server },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#09090b] relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(#2a2a2e 1px, transparent 1px), linear-gradient(90deg, #2a2a2e 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
      <div className="absolute w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,rgba(245,158,11,.06),transparent_70%)] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />

      <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-8 md:p-10 w-full max-w-[520px] relative z-10 shadow-[0_4px_24px_rgba(0,0,0,.4)]">
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="w-[60px] h-[60px] bg-gradient-to-br from-[#f59e0b] to-[#d97706] rounded-xl inline-flex items-center justify-center text-[26px] text-black mb-3.5 shadow-[0_4px_24px_rgba(245,158,11,.3)]">
            <Play size={26} />
          </div>
          <h1 className="text-[26px] font-black">IPTV <span className="text-[#f59e0b]">Pro</span></h1>
          <p className="text-[#a1a1aa] text-[13px] mt-1">مشغل قنوات احترافي متكامل</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-[3px] bg-[#111114] rounded-xl p-[3px] mb-5">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 px-2 border-none bg-transparent text-[12.5px] font-medium rounded-lg cursor-pointer transition-all duration-200 flex items-center justify-center gap-1.5 ${
                activeTab === tab.key ? 'bg-[#18181b] text-[#f59e0b] shadow-[0_2px_8px_rgba(0,0,0,.3)]' : 'text-[#a1a1aa] hover:text-[#fafafa]'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content: M3U URL */}
        {activeTab === 'm3uurl' && (
          <div>
            <div className="mb-3.5">
              <label className="block text-[12px] font-medium text-[#a1a1aa] mb-1.5">رابط ملف M3U</label>
              <input
                type="url"
                value={m3uUrl}
                onChange={e => setM3uUrl(e.target.value)}
                placeholder="https://example.com/channels.m3u"
                className="w-full px-3.5 py-2.5 bg-[#111114] border border-[#2a2a2e] rounded-lg text-[#fafafa] text-[13px] outline-none transition-all duration-200 focus:border-[#f59e0b] focus:shadow-[0_0_0_3px_rgba(245,158,11,.15)] ltr text-left"
                dir="ltr"
              />
            </div>
            <div className="mb-3.5">
              <label className="block text-[12px] font-medium text-[#a1a1aa] mb-1.5">اسم الاتصال (اختياري)</label>
              <input
                type="text"
                value={m3uUrlName}
                onChange={e => setM3uUrlName(e.target.value)}
                placeholder="مثال: قنواتي الخاصة"
                className="w-full px-3.5 py-2.5 bg-[#111114] border border-[#2a2a2e] rounded-lg text-[#fafafa] text-[13px] outline-none transition-all duration-200 focus:border-[#f59e0b] focus:shadow-[0_0_0_3px_rgba(245,158,11,.15)]"
              />
            </div>
          </div>
        )}

        {/* Tab Content: File Upload */}
        {activeTab === 'm3ufile' && (
          <div>
            <div
              className={`border-2 border-dashed border-[#2a2a2e] rounded-xl p-8 text-center cursor-pointer transition-all duration-200 relative ${uploadedFile ? 'border-[#f59e0b] bg-[rgba(245,158,11,.15)]' : 'hover:border-[#f59e0b] hover:bg-[rgba(245,158,11,.08)]'}`}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-[#f59e0b]', 'bg-[rgba(245,158,11,.15)]'); }}
              onDragLeave={e => { e.preventDefault(); e.currentTarget.classList.remove('border-[#f59e0b]', 'bg-[rgba(245,158,11,.15)]'); }}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={32} className={`mx-auto mb-2.5 ${uploadedFile ? 'text-[#f59e0b]' : 'text-[#52525b]'}`} />
              <p className="text-[#a1a1aa] text-[13px]">اسحب ملف M3U هنا أو اضغط للاختيار</p>
              {uploadedFile && <p className="text-[#f59e0b] font-medium mt-1.5 text-[13px]">{uploadedFile.name}</p>}
              <input ref={fileInputRef} type="file" accept=".m3u,.m3u8,.txt" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileSelect} />
            </div>
            <div className="mt-3.5">
              <label className="block text-[12px] font-medium text-[#a1a1aa] mb-1.5">اسم الاتصال (اختياري)</label>
              <input
                type="text"
                value={m3uFileName}
                onChange={e => setM3uFileName(e.target.value)}
                placeholder="مثال: قائمة القنوات"
                className="w-full px-3.5 py-2.5 bg-[#111114] border border-[#2a2a2e] rounded-lg text-[#fafafa] text-[13px] outline-none transition-all duration-200 focus:border-[#f59e0b] focus:shadow-[0_0_0_3px_rgba(245,158,11,.15)]"
              />
            </div>
          </div>
        )}

        {/* Tab Content: Xtream */}
        {activeTab === 'xtream' && (
          <div>
            {[{ label: 'عنوان السيرفر', val: xtServer, set: setXtServer, ph: 'http://server.com:8080', type: 'text' as const },
              { label: 'اسم المستخدم', val: xtUser, set: setXtUser, ph: 'username' },
              { label: 'كلمة المرور', val: xtPass, set: setXtPass, ph: 'password', type: 'password' as const },
              { label: 'اسم الاتصال (اختياري)', val: xtName, set: setXtName, ph: 'مثال: سيرفر خاص' },
            ].map(f => (
              <div key={f.label} className="mb-3.5">
                <label className="block text-[12px] font-medium text-[#a1a1aa] mb-1.5">{f.label}</label>
                <input
                  type={f.type || 'text'}
                  value={f.val}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.ph}
                  className={`w-full px-3.5 py-2.5 bg-[#111114] border border-[#2a2a2e] rounded-lg text-[#fafafa] text-[13px] outline-none transition-all duration-200 focus:border-[#f59e0b] focus:shadow-[0_0_0_3px_rgba(245,158,11,.15)] ${f.type !== 'password' ? 'ltr text-left' : ''}`}
                  dir={f.type !== 'password' ? 'ltr' : 'rtl'}
                />
              </div>
            ))}
          </div>
        )}

        {/* Connect Button */}
        <button
          onClick={handleConnect}
          disabled={loading}
          className={`w-full py-3 bg-gradient-to-r from-[#f59e0b] to-[#d97706] border-none rounded-xl text-black text-[14px] font-bold cursor-pointer transition-all duration-200 mt-1 flex items-center justify-center gap-2 ${
            loading ? 'opacity-40 cursor-not-allowed' : 'hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(245,158,11,.4)] active:translate-y-0'
          }`}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
          {loading ? 'جاري الاتصال...' : 'اتصال'}
        </button>

        {/* Status */}
        {status && (
          <div className={`mt-3 px-3.5 py-2.5 rounded-lg text-[12.5px] flex items-center gap-2 hidden ${status.cls === 'ld' ? '!flex bg-[rgba(245,158,11,.1)] text-[#f59e0b]' : status.cls === 'er' ? '!flex bg-[rgba(239,68,68,.1)] text-[#ef4444]' : '!flex bg-[rgba(34,197,94,.1)] text-[#22c55e]'}`} dangerouslySetInnerHTML={{ __html: status.html }} />
        )}

        {/* Progress Bar */}
        <div className={`h-[3px] bg-[#27272a] rounded-full mt-2.5 overflow-hidden ${progress >= 0 ? 'block' : 'hidden'}`}>
          <div className="h-full bg-[#f59e0b] rounded-full transition-all duration-300" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>

        {/* Saved Connections */}
        {savedConnections.length > 0 && (
          <div className="mt-5 pt-4 border-t border-[#2a2a2e]">
            <h3 className="text-[12px] text-[#52525b] mb-2 font-medium flex items-center gap-1.5"><History size={12} /> الاتصالات المحفوظة</h3>
            <div className="space-y-1">
              {savedConnections.map(s => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-[#111114] rounded-lg cursor-pointer hover:bg-[#27272a] transition-colors" onClick={() => {
                  if (s.type === 'm3u-url') { setM3uUrl(s.url || ''); setM3uUrlName(s.name || ''); setActiveTab('m3uurl'); }
                  else if (s.type === 'xtream') { setXtServer(s.server || ''); setXtUser(s.user || ''); setXtPass(s.pass || ''); setXtName(s.name || ''); setActiveTab('xtream'); }
                  else toast('ملفات M3U المحفوظة تحتاج إعادة رفع', 'warning');
                }}>
                  <div className="flex items-center gap-2.5 text-[12.5px]">
                    {s.type === 'xtream' ? <Server size={13} className="text-[#f59e0b]" /> : <Link size={13} className="text-[#f59e0b]" />}
                    <span className="font-medium max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap">{s.name || s.type}</span>
                    <span className="text-[#52525b] text-[10px] mr-1">{s.type === 'xtream' ? 'Xtream' : 'M3U'}</span>
                  </div>
                  <button className="bg-transparent border-0 text-[#52525b] cursor-pointer px-1 py-1 rounded transition-colors hover:text-[#ef4444] hover:bg-[rgba(239,68,68,.1)]" onClick={e => { e.stopPropagation(); if (s.id) onDeleteSaved(s.id); }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
