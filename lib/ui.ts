// lib/ui.ts — tokeny systemu projektowego (redesign Attio-style) + helpery
// formatowania. Zasada: neutralne, jasne UI, subtelne szare obrysy, mały
// promień zaokrąglenia, kompaktowe kontrolki, jeden wyraźny kolor akcentu.
// UWAGA: te tokeny stylują WYŁĄCZNIE panel admina — publiczny renderer
// formularzy (components/FormRenderer.tsx, app/f/*) ma własne style.
import type { CSSProperties } from "react";

export const tokens = {
  // ── Powierzchnie ─────────────────────────────────────────────────────────
  bg: "#F7F7F8",
  card: "#FFFFFF",
  // Delikatne tło zagłębione (nagłówki tabel, wiersze zebra, pola „read-only").
  surface: "#FAFAFB",
  border: "#E5E6EB",
  // Delikatniejszy obrys — separatory wierszy tabel, wewnętrzne linie.
  borderSoft: "#EEEFF2",
  // ── Hierarchia tekstu ────────────────────────────────────────────────────
  text: "#17181C",
  muted: "#75798A",
  // Trzeci poziom — placeholdery, wyłączone etykiety, znaki „—".
  faint: "#9AA0B0",
  // ── Marka + akcent ───────────────────────────────────────────────────────
  accent: "#6C5CE7",
  accentSoft: "rgba(108,92,231,0.09)",
  // ── Kolory semantyczne + ich miękkie tła (badge/chip/alert) ──────────────
  success: "#18A957",
  successSoft: "rgba(24,169,87,0.10)",
  warning: "#F2994A",
  warningSoft: "rgba(242,153,74,0.12)",
  // Ciemniejszy amber do TEKSTU/obrysu na miękkim tle ostrzeżenia (kontrast).
  warningStrong: "#8A5A1A",
  danger: "#E5484D",
  dangerSoft: "rgba(229,72,77,0.10)",
  info: "#1A73E7",
  infoSoft: "rgba(26,115,231,0.10)",
  // ── Skala promienia (jedno źródło) ───────────────────────────────────────
  // sm  → kontrolki: przyciski, pola, chipy, małe ikony-przyciski
  // radius (md) → karty, panele, modale, dropdowny
  // full → awatary, kropki statusu, paski postępu
  radiusSm: 7,
  radius: 10,
  radiusFull: 999,
  // typowe płynne przejście (cubic-bezier)
  ease: "cubic-bezier(.22,1,.36,1)",
  // ── Elewacja: filozofia „obrys zamiast cienia" (Attio). Cienie WYŁĄCZNIE
  // dla elementów pływających nad treścią (menu, modale). Karty = obrys. ────
  shadowSm: "0 1px 2px rgba(15,18,28,0.05)",
  shadowMenu: "0 4px 16px rgba(15,18,28,0.10), 0 1px 3px rgba(15,18,28,0.06)",
  shadowModal: "0 16px 48px rgba(15,18,28,0.16)",
} as const;

// ── Skala odstępów (spacing) ───────────────────────────────────────────────
// Jedna skala 4-punktowa. `pagePad`/`cardPad` używane przez helpery poniżej.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  /** Padding treści strony (odpowiada .selltic-main w globals.css). */
  page: 24,
  /** Wewnętrzny padding kart / kafli / paneli. */
  card: 16,
  /** Odstęp pionowy między sekcjami strony. */
  section: 16,
} as const;

// ── Skala typografii (Inter wszędzie) ──────────────────────────────────────
// Każdy tekst w panelu mapuje się na JEDEN z tych presetów. Poza skalą nie
// używamy arbitralnych rozmiarów (żadnych text-[15px]/fontSize: 17 itd.).
export const font = {
  /** Duża liczba KPI / wartość kafla. */
  display: { fontSize: 22, fontWeight: 700, lineHeight: 1.15 } as CSSProperties,
  /** Tytuł strony (h1) — jeden na widok. */
  title: { fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.25 } as CSSProperties,
  /** Nagłówek sekcji / karty / modala (h2). */
  heading: { fontSize: 15, fontWeight: 600, lineHeight: 1.3 } as CSSProperties,
  /** Pod-nagłówek / tytuł mniejszej karty. */
  subheading: { fontSize: 14, fontWeight: 600, lineHeight: 1.35 } as CSSProperties,
  /** Tekst podstawowy (wiersze tabel, pola, treść). */
  body: { fontSize: 13, fontWeight: 400, lineHeight: 1.45 } as CSSProperties,
  /** Tekst podstawowy pogrubiony (nazwy rekordów, wartości). */
  bodyStrong: { fontSize: 13, fontWeight: 600, lineHeight: 1.45 } as CSSProperties,
  /** Tekst drugorzędny / meta (podpisy, opisy pod nagłówkiem). */
  secondary: { fontSize: 12, fontWeight: 400, lineHeight: 1.4 } as CSSProperties,
  /** Meta drobne + tekst badge/chip. */
  meta: { fontSize: 11.5, fontWeight: 500, lineHeight: 1.4 } as CSSProperties,
  /** Etykieta wersalikowa (nagłówki grup, sekcje). */
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } as CSSProperties,
} as const;

// Paleta kategorialna wykresów (recharts) — stała kolejność, spójna między
// widokami. Zaczyna od akcentu; kolejne to kolory semantyczne + neutralne.
export const chartPalette = [
  tokens.accent,
  tokens.info,
  tokens.warning,
  tokens.success,
  tokens.danger,
  "#00B8A9",
  "#8A92A6",
] as const;

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

// Przycisk drugorzędny WYPEŁNIONY (jasnoszare tło) — używany, gdy akcja
// zasługuje na większy nacisk niż „ghost", ale nie jest główną akcją strony.
export const secondaryButton: CSSProperties = {
  ...ghostButton,
  background: tokens.bg,
  borderColor: tokens.border,
};

// Przycisk destrukcyjny (obrys, czerwony tekst) — kasowanie, archiwizacja.
export const dangerButton: CSSProperties = {
  ...ghostButton,
  color: tokens.danger,
  borderColor: "rgba(229,72,77,0.35)",
};

// Rozmiary przycisków. Domyślny (md) = 30 px, jak w helperach powyżej; sm to
// kompaktowe akcje w gęstych paskach narzędzi; lg dla pustych stanów / CTA.
export type BtnSize = "sm" | "md" | "lg";
export function btnSize(size: BtnSize): CSSProperties {
  if (size === "sm") return { minHeight: 26, padding: "3px 9px", fontSize: 12.5 };
  if (size === "lg") return { minHeight: 36, padding: "8px 16px", fontSize: 14 };
  return {}; // md — wartości domyślne w primaryButton/ghostButton
}

// Fabryka przycisku: łączy wariant z rozmiarem w jednym miejscu.
export type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
const BTN_BASE: Record<BtnVariant, CSSProperties> = {
  primary: primaryButton,
  secondary: secondaryButton,
  ghost: ghostButton,
  danger: dangerButton,
};
export function button(variant: BtnVariant = "primary", size: BtnSize = "md"): CSSProperties {
  return { ...BTN_BASE[variant], ...btnSize(size) };
}

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
    borderRadius: tokens.radiusSm,
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

// Nagłówek strony (h1) — jeden preset z font.title. Preferuj komponent
// <PageHeader> (components/PageHeader.tsx) zamiast ręcznego <h1>.
export const pageTitle: CSSProperties = {
  ...font.title,
  margin: 0,
  color: tokens.text,
};

// Etykieta sekcji (uppercase, drobna).
export const sectionLabel: CSSProperties = {
  ...font.label,
  color: tokens.muted,
};

// Karta / panel treści — obrys zamiast cienia (Attio). Jedno źródło wyglądu
// dla kart, kafli KPI, paneli ustawień, sekcji wykresów.
export function cardStyle(pad: number = space.card): CSSProperties {
  return {
    background: tokens.card,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radius,
    padding: pad,
  };
}

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
