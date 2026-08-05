import { X } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isDestructive = true,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div 
        className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="p-5">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <button 
              onClick={onCancel}
              className="p-1 rounded-full text-white/40 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            {message}
          </p>
        </div>
        
        <div className="p-4 bg-zinc-950/50 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white/70 bg-white/5 hover:bg-white/10 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onCancel(); // auto-close
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all ${
              isDestructive 
                ? "bg-red-600 text-white hover:bg-red-500 hover:shadow-red-500/25" 
                : "bg-white text-black hover:bg-white/90"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
