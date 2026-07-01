"use client";

import * as React from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (t: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue["toast"]>(
    ({ title, description, variant = "info" }) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, title, description, variant }]);
      window.setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
        aria-live="polite"
        aria-atomic="true"
      >
        {items.map((item) => (
          <ToastView key={item.id} item={item} onClose={() => remove(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICONS: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const ACCENTS: Record<ToastVariant, string> = {
  success: "text-[#34d399]",
  error: "text-[#f87171]",
  info: "text-[#a5b4fc]",
};

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const Icon = ICONS[item.variant];
  return (
    <div className="pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-xl border border-white/[0.08] bg-[#13131a] p-4 shadow-xl shadow-black/40">
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", ACCENTS[item.variant])} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[#f0f0f5]">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-[12px] text-white/45">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/[0.06]"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
