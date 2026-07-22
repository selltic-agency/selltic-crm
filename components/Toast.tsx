// components/Toast.tsx — lekki system powiadomień „toast”.
// Provider montowany w panelu (admin/layout). Komponenty wywołują useToast().
// Wariant `undo(...)` (Gmail-style) pokazuje przycisk „Cofnij" przez ~5 s.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { tokens } from "@/lib/ui";
import MIcon from "@/components/MaterialIcon";

type ToastKind = "success" | "error" | "info";
type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
};

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  /** Toast z akcją „Cofnij" (Gmail-style), widoczny ~5 s. */
  undo: (message: string, onUndo: () => void) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

const ICON: Record<ToastKind, string> = {
  success: "check_circle",
  error: "error",
  info: "info",
};
const COLOR: Record<ToastKind, string> = {
  success: tokens.success,
  error: tokens.danger,
  info: tokens.accent,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const reduce = useReducedMotion();
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (item: Omit<ToastItem, "id">, duration: number) => {
      const id = Date.now() + Math.random();
      setItems((list) => [...list, { ...item, id }]);
      timers.current.set(
        id,
        setTimeout(() => remove(id), duration)
      );
    },
    [remove]
  );

  const toast = useCallback(
    (message: string, kind: ToastKind = "success") => push({ kind, message }, 3500),
    [push]
  );

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
    info: (m) => toast(m, "info"),
    undo: (message, onUndo) => push({ kind: "info", message, action: { label: "Cofnij", onClick: onUndo } }, 5000),
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
          gap: 8,
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              role="status"
              layout={!reduce}
              initial={{ opacity: 0, y: reduce ? 0 : 16, scale: reduce ? 1 : 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduce ? 0 : 8, scale: reduce ? 1 : 0.98 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 350, damping: 28 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                minWidth: 220,
                maxWidth: 380,
                background: tokens.card,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radius,
                padding: "9px 12px",
                boxShadow: tokens.shadowMenu,
              }}
            >
              <MIcon name={ICON[t.kind]} size={17} color={COLOR[t.kind]} />
              <span style={{ flex: 1, fontSize: 13, color: tokens.text }}>{t.message}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    remove(t.id);
                  }}
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    padding: "2px 6px",
                    borderRadius: 6,
                    color: tokens.accent,
                    fontSize: 12.5,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {t.action.label}
                </button>
              )}
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
                  color: tokens.muted,
                  flexShrink: 0,
                }}
              >
                <MIcon name="close" size={15} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  // Bezpieczny fallback (np. render poza providerem) — nie wywróci aplikacji.
  if (!ctx) {
    const noop = () => {};
    return { toast: noop, success: noop, error: noop, info: noop, undo: noop };
  }
  return ctx;
}
