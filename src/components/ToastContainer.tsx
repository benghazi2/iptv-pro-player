import { ToastType } from '../hooks/useToast';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface Props {
  toasts: ToastItem[];
}

const typeClasses: Record<ToastType, string> = {
  info: 'bg-[#18181b] border border-[#27272a] text-[#fafafa]',
  success: 'bg-[rgba(34,197,94,.12)] border border-[rgba(34,197,94,.25)] text-[#22c55e]',
  error: 'bg-[rgba(239,68,68,.12)] border border-[rgba(239,68,68,.25)] text-[#ef4444]',
  warning: 'bg-[rgba(245,158,11,.12)] border border-[rgba(245,158,11,.25)] text-[#f59e0b]',
};

export default function ToastContainer({ toasts }: Props) {
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-1.5 items-center pointer-events-none">
      {toasts.map((t: ToastItem) => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg max-w-[90vw] whitespace-normal text-center ${typeClasses[t.type]}`}
          style={{ animation: 'toastIn 0.3s ease forwards' }}
        >
          {t.message}
        </div>
      ))}
      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
