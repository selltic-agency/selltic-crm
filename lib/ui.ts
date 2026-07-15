// lib/ui.ts — tokeny systemu projektowego (REQUIREMENTS.md §9) + helpery formatowania.
import type { CSSProperties } from "react";

export const tokens = {
  bg: "#F6F7F9",
  card: "#FFFFFF",
  border: "#ECEEF3",
  text: "#1A1D26",
  muted: "#8A92A6",
  accent: "#6C5CE7",
  accentSoft: "rgba(108,92,231,0.10)",
  success: "#18A957",
  warning: "#F2994A",
  danger: "#E5484D",
  radius: 16,
  // typowe płynne przejście (REQUIREMENTS.md §9 — cubic-bezier)
  ease: "cubic-bezier(.22,1,.36,1)",
} as const;

// Data/godzina w formacie "dd mmm yyyy, HH:MM" (locale PL).
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Data względna ("2 godziny temu", "wczoraj", "3 dni temu"). Fallback do daty.
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 45) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  if (hr < 24) return `${hr} godz. temu`;
  if (day === 1) return "wczoraj";
  if (day < 30) return `${day} dni temu`;
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
}

// Kwoty w PLN.
export function formatPLN(value: number): string {
  return `${Number(value || 0).toLocaleString("pl-PL")} zł`;
}

// Wartość dla <input type="datetime-local"> z ISO (lokalna strefa).
export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// Wspólne style pól formularzy.
export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: `1px solid ${tokens.border}`,
  borderRadius: 10,
  fontSize: 14,
  color: tokens.text,
  background: "#fff",
  outline: "none",
};

export const primaryButton: CSSProperties = {
  padding: "10px 16px",
  background: tokens.accent,
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export const ghostButton: CSSProperties = {
  padding: "9px 14px",
  background: "#fff",
  color: tokens.text,
  border: `1px solid ${tokens.border}`,
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
