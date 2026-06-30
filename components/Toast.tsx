// components/Toast.tsx — lekki system powiadomień „toast”.
// Provider montowany w panelu (admin/layout). Komponenty wywołują useToast().
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { tokens } from "@/lib/ui";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

const ICON: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};
const COLOR: Record<ToastKind, string> = {
  success: tokens.success,
  error: tokens.danger,
  info: tokens.accent,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "success") => {
      const id = Date.now() + Math.random();
      setItems((list) => [...list, { id, kind, message }]);
      setTimeout(() => remove(id), 3500);
    },
    [remove]
  );

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
    info: (m) => toast(m, "info"),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <style>{`
          @keyframes selltic-toast-in {
            from { opacity: 0; transform: translateY(12px) scale(.98); }
            to   { opacity: 1; transform: none; }
          }
        `}</style>
        {items.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minWidth: 240,
                maxWidth: 380,
                background: tokens.card,
                border: `1px solid ${tokens.border}`,
                borderLeft: `3px solid ${COLOR[t.kind]}`,
                borderRadius: 12,
                padding: "12px 14px",
                boxShadow: "0 8px 30px rgba(15,18,28,0.14)",
                animation: `selltic-toast-in .26s ${tokens.ease}`,
              }}
            >
              <Icon size={18} color={COLOR[t.kind]} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, color: tokens.text }}>
                {t.message}
              </span>
              <button
                onClick={() => remove(t.id)}
                aria-label="Zamknij"
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  padding: 2,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <X size={15} color={tokens.muted} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  // Bezpieczny fallback (np. render poza providerem) — nie wywróci aplikacji.
  if (!ctx) {
    const noop = () => {};
    return { toast: noop, success: noop, error: noop, info: noop };
  }
  return ctx;
}
