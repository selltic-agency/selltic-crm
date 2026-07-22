// lib/ui.ts — tokeny systemu projektowego (redesign Attio-style) + helpery
// formatowania. Zasada: neutralne, jasne UI, subtelne szare obrysy, mały
// promień zaokrąglenia, kompaktowe kontrolki, jeden wyraźny kolor akcentu.
// UWAGA: te tokeny stylują WYŁĄCZNIE panel admina — publiczny renderer
// formularzy (components/FormRenderer.tsx, app/f/*) ma własne style.
import type { CSSProperties } from "react";

export const tokens = {
  bg: "#F7F7F8",
  card: "#FFFFFF",
  border: "#E5E6EB",
  // Delikatniejszy obrys — separatory wierszy tabel, wewnętrzne linie.
  borderSoft: "#EEEFF2",
  text: "#17181C",
  muted: "#75798A",
  accent: "#6C5CE7",
  accentSoft: "rgba(108,92,231,0.09)",
  success: "#18A957",
  warning: "#F2994A",
  danger: "#E5484D",
  // Promień kart/paneli. Kontrolki (przyciski, pola) używają radiusSm.
  radius: 10,
  radiusSm: 7,
  // typowe płynne przejście (cubic-bezier)
  ease: "cubic-bezier(.22,1,.36,1)",
  // Cienie: powściągliwe — tylko elementy pływające (menu, modale).
  shadowMenu: "0 4px 16px rgba(15,18,28,0.10), 0 1px 3px rgba(15,18,28,0.06)",
  shadowModal: "0 16px 48px rgba(15,18,28,0.16)",
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

// ── Wspólne style kontrolek (Attio-style: kompaktowe, mały promień) ───────

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 10px",
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radiusSm,
  fontSize: 13,
  lineHeight: 1.45,
  color: tokens.text,
  background: "#fff",
  outline: "none",
}

export const primaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "5px 12px",
  minHeight: 30,
  background: tokens.accent,
  color: "#fff",
  border: "1px solid transparent",
  borderRadius: tokens.radiusSm,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// „Cichy" przycisk drugorzędny: biały, subtelny obrys, bez cienia.
export const ghostButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "5px 11px",
  minHeight: 30,
  background: "#fff",
  color: tokens.text,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radiusSm,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// Przycisk destrukcyjny (obrys, czerwony tekst) — kasowanie, archiwizacja.
export const dangerButton: CSSProperties = {
  ...ghostButton,
  color: tokens.danger,
  borderColor: "rgba(229,72,77,0.35)",
};

// Kwadratowy przycisk z samą ikoną (zamknij, menu ⋯, itd.).
export const iconButton: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: tokens.radiusSm,
  flexShrink: 0,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  color: tokens.muted,
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  padding: 0,
};

// Wariant „goły" (bez obrysu) — w ciasnych rzędach, np. wiersze list.
export const bareIconButton: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  flexShrink: 0,
  border: "none",
  background: "transparent",
  color: tokens.muted,
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  padding: 0,
};

// Stonowany chip/badge (Attio-style): szare tło, bez krzykliwych kolorów.
export function chipStyle(color?: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "1px 8px",
    borderRadius: 6,
    fontSize: 11.5,
    fontWeight: 500,
    lineHeight: "18px",
    color: color ?? tokens.muted,
    background: color ? `${color}14` : tokens.bg,
    border: `1px solid ${color ? `${color}2E` : tokens.border}`,
    whiteSpace: "nowrap",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

// Panel pływający (dropdown/menu/popover) — jedno źródło wyglądu.
export const menuPanel: CSSProperties = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radius,
  boxShadow: tokens.shadowMenu,
  overflow: "hidden",
};

// Nagłówek strony (h1) — mniejszy, gęstszy niż poprzednio.
export const pageTitle: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  margin: 0,
  color: tokens.text,
};

// Etykieta sekcji (uppercase, drobna).
export const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: tokens.muted,
};

// Komórki tabel — wspólna gęstość dla wszystkich list w panelu.
export const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "7px 12px",
  fontSize: 11.5,
  fontWeight: 500,
  color: tokens.muted,
  whiteSpace: "nowrap",
  userSelect: "none",
};

export const tdStyle: CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  color: tokens.text,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
