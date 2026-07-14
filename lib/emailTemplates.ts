// lib/emailTemplates.ts — pola dynamiczne i renderowanie szablonów e-mail.
// Szablony (Integracje → Szablony e-mail) mają placeholdery {{first_name}} itp.
// Przy wysyłce z karty leada podstawiamy je danymi konkretnego deala.
//
// Dwie ścieżki renderowania:
//   • renderText  — dla TEMATU (zwykły tekst, bez escapowania),
//   • renderHtml  — dla TREŚCI (HTML) — wartości leada escapujemy, żeby dane
//     z bazy (np. „<” w nazwie) nie psuły / nie wstrzykiwały znaczników.
import type { Deal } from "@/lib/types";

// Pole dynamiczne: klucz w składni {{key}}, etykieta w pickerze, przykładowa
// wartość do podglądu na „sztucznych” danych.
export type TemplateField = { key: string; label: string; sample: string };

// Lista pól dostępnych w pickerze. Klucze mapują się na kolumny deala
// (patrz dealFieldValues) lub są wyprowadzane (first_name / last_name z name).
export const TEMPLATE_FIELDS: TemplateField[] = [
  { key: "first_name", label: "Imię", sample: "Anna" },
  { key: "last_name", label: "Nazwisko", sample: "Kowalska" },
  { key: "name", label: "Nazwa / osoba", sample: "Anna Kowalska" },
  { key: "company", label: "Firma", sample: "Kwiaciarnia Róża" },
  { key: "email", label: "E-mail", sample: "anna@rozakwiaty.pl" },
  { key: "phone", label: "Telefon", sample: "600 100 200" },
  { key: "industry", label: "Branża", sample: "Kwiaciarnia" },
  { key: "city", label: "Miasto", sample: "Warszawa" },
  { key: "website", label: "Strona WWW", sample: "rozakwiaty.pl" },
  { key: "address", label: "Adres", sample: "ul. Kwiatowa 1, Warszawa" },
];

// Przykładowe wartości do podglądu, gdy nie ma realnego leada (edytor szablonu).
export const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  TEMPLATE_FIELDS.map((f) => [f.key, f.sample])
);

// Rozbija pełną nazwę na imię + resztę (nazwisko). Prosta heurystyka —
// pierwsze słowo to imię, reszta to nazwisko.
function splitName(full?: string | null): { first: string; last: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Zbiór wartości pól dla konkretnego deala (leada).
export function dealFieldValues(deal: Deal): Record<string, string> {
  const { first, last } = splitName(deal.name);
  return {
    first_name: first,
    last_name: last,
    name: deal.name ?? "",
    company: deal.company ?? "",
    email: deal.email ?? "",
    phone: deal.phone ?? "",
    industry: deal.industry ?? "",
    city: deal.city ?? "",
    website: deal.website ?? "",
    address: deal.address ?? "",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

// Podstawia {{key}} w zwykłym tekście (temat). Nieznane pola → pusty string.
export function renderText(tpl: string, values: Record<string, string>): string {
  return (tpl || "").replace(PLACEHOLDER_RE, (_m, k: string) => values[k.toLowerCase()] ?? "");
}

// Podstawia {{key}} w treści HTML. Wartości leada są escapowane (bezpieczne
// wstawienie danych z bazy do HTML). Sam szablon (autorstwa właściciela) — nie.
export function renderHtml(tpl: string, values: Record<string, string>): string {
  return (tpl || "").replace(PLACEHOLDER_RE, (_m, k: string) =>
    escapeHtml(values[k.toLowerCase()] ?? "")
  );
}

// Zwraca listę kluczy placeholderów użytych w tekście (do podpowiedzi/walidacji).
export function usedPlaceholders(tpl: string): string[] {
  const out = new Set<string>();
  for (const m of (tpl || "").matchAll(PLACEHOLDER_RE)) out.add(m[1].toLowerCase());
  return [...out];
}
