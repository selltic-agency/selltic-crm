// lib/design.ts — tokeny systemu projektowego (REQUIREMENTS §9) + formatery.
// Wszystkie ekrany używają tych wartości — zero przypadkowych kolorów.

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
  radius: 16,
} as const;

// Czas: zapis jako timestamptz, prezentacja jako „dd mmm yyyy, HH:MM" (pl-PL).
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Kwoty zawsze w PLN, formatowane lokalnie.
export function formatPLN(value: number): string {
  return `${(value ?? 0).toLocaleString("pl-PL")} zł`;
}

// Etykieta źródła kontaktu: „form:wycena" → „📋 wycena", inaczej tekst lub „Ręcznie".
export function sourceLabel(source: string | null): string {
  if (!source) return "Ręcznie";
  if (source.startsWith("form:")) return `📋 ${source.slice(5)}`;
  return source;
}
