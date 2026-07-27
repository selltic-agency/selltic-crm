// lib/website.ts — jedno źródło prawdy o „stanie strony WWW" prospekta.
//
// Dane o stronie trafiają do CRM-u trzema drogami i każda zapisuje je trochę
// inaczej:
//   1. scraper → `scraped_leads` → „Przenieś do Prospectingu" (website_status
//      po polsku: 'brak' | 'dziala' | 'nie_dziala'),
//   2. zewnętrzny scraper → POST /api/prospecting/import (website_status
//      przychodzi w dowolnej z tych konwencji, bywa że wcale),
//   3. ręczna edycja w CRM.
// Efekt: część prospektów ma sam `website`, część sam `website_status`, część
// pusty string zamiast NULL-a, a część tylko opis w `lead_score_breakdown`
// ("Brak strony/domeny"). Dlatego UI NIE czyta tych kolumn wprost — woła
// `websiteInfo()`, które scala wszystkie źródła w jeden, spójny wynik.
//
// Zasada rozstrzygania: adres strony > zapisany status > opis ze scoringu.
// Nigdy nie zgadujemy „Brak strony", gdy po prostu nie mamy danych — wtedy
// stan jest `unknown` i UI pokazuje „—".
import type { WebsiteStatus } from "@/lib/types";

export const WEBSITE_STATUS_LABEL: Record<WebsiteStatus, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

// Warianty zapisu statusu spotykane w danych (scraper po polsku, importy po
// angielsku, stare rekordy z literówkami/spacjami). Klucz = wartość po
// `canonical()` (małe litery, bez ogonków, spacje/myślniki → podkreślenia).
const STATUS_ALIASES: Record<string, WebsiteStatus> = {
  none: "none",
  brak: "none",
  brak_strony: "none",
  bez_strony: "none",
  no_website: "none",
  nie: "none",
  active: "active",
  dziala: "active",
  strona_dziala: "active",
  ok: "active",
  online: "active",
  up: "active",
  working: "active",
  tak: "active",
  broken: "broken",
  nie_dziala: "broken",
  niedziala: "broken",
  strona_nie_dziala: "broken",
  error: "broken",
  offline: "broken",
  down: "broken",
  slow: "slow",
  wolna: "slow",
  wolno: "slow",
  strona_wolna: "slow",
};

// Teksty, które w praktyce znaczą „nie ma adresu", a bywają zapisane w kolumnie
// `website` zamiast NULL-a.
const URL_PLACEHOLDERS = new Set([
  "",
  "-",
  "--",
  "—",
  "brak",
  "brak_strony",
  "brak_danych",
  "n_a",
  "na",
  "nd",
  "nie",
  "none",
  "null",
  "undefined",
  "false",
  "0",
]);

// Małe litery, bez polskich ogonków, separatory ujednolicone do „_".
function canonical(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[\s.\-/]+/g, "_");
}

/**
 * Sprowadza dowolny zapis statusu strony do enumu z bazy (`prospects.website_status`).
 * Zwraca null, gdy wartości nie da się rozpoznać — wtedy stan jest nieznany,
 * a nie „brak strony".
 */
export function normalizeWebsiteStatus(raw: unknown): WebsiteStatus | null {
  if (typeof raw !== "string") return null;
  const key = canonical(raw);
  if (!key) return null;
  return STATUS_ALIASES[key] ?? null;
}

/**
 * Sprowadza zapisany adres strony do klikalnego URL-a (zawsze ze schematem,
 * inaczej `<a href>` byłby linkiem względnym wewnątrz CRM-u!). Zwraca null dla
 * pustych stringów, placeholderów ("brak", "-", "n/a") i wartości, które nie są
 * adresem WWW (np. e-mail).
 */
export function normalizeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Bywa, że adres przyjeżdża w cudzysłowie albo z białymi znakami w środku.
  const trimmed = raw.trim().replace(/^["'<]+|["'>]+$/g, "").replace(/\s+/g, "");
  if (!trimmed) return null;
  if (URL_PLACEHOLDERS.has(canonical(trimmed))) return null;
  if (/^mailto:|^tel:/i.test(trimmed)) return null;

  // Bez schematu (albo z „//") — dokładamy https, żeby link działał.
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Host musi wyglądać jak domena (kropka + sensowne znaki) — odsiewa
  // „brak strony", adresy e-mail i śmieci wpisane ręcznie.
  const host = url.hostname;
  if (!host.includes(".") || /[^a-z0-9.\-\u00a1-\uffff]/i.test(host)) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** Skrócony adres do wyświetlenia: bez schematu, bez „www.", bez końcowego „/". */
export function websiteHost(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "");
    const path = (u.pathname === "/" ? "" : u.pathname).replace(/\/+$/, "");
    return `${host}${path}${u.search}`;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
}

// Rozpoznanie stanu strony z tekstu opisu (scoring scrapera zapisuje np.
// „Brak strony/domeny", „Strona nie działa", „Strona działa (niemobilna)").
// Kolejność sprawdzeń ma znaczenie: „nie działa" musi wygrać z „działa".
function statusFromText(raw: string): WebsiteStatus | null {
  const t = canonical(raw);
  if (!t.includes("stron") && !t.includes("domen") && !t.includes("website")) return null;
  if (t.includes("brak") || t.includes("bez_")) return "none";
  if (t.includes("nie_dziala") || t.includes("niedziala") || t.includes("nieczynn")) return "broken";
  if (t.includes("woln")) return "slow";
  if (t.includes("dziala")) return "active";
  return null;
}

/**
 * Wyciąga stan strony z rozbicia lead score (`lead_score_breakdown`, kształt
 * { klucz: { punkty, opis } }) albo ze starych `props.score_reasons` (lista
 * stringów). To ostatnia deska ratunku, gdy kolumny są puste.
 */
export function websiteStatusFromScoring(breakdown: unknown, reasons?: unknown): WebsiteStatus | null {
  if (breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)) {
    for (const [key, value] of Object.entries(breakdown as Record<string, unknown>)) {
      const opis = (value as { opis?: unknown })?.opis;
      const found =
        (typeof opis === "string" ? statusFromText(opis) : null) ??
        (typeof value === "string" ? statusFromText(value) : null) ??
        statusFromText(key);
      if (found) return found;
    }
  }
  if (Array.isArray(reasons)) {
    for (const r of reasons) {
      if (typeof r !== "string") continue;
      const found = statusFromText(r);
      if (found) return found;
    }
  }
  return null;
}

/** Wejście dla `websiteInfo()` — pasuje do Prospect, ScrapedLead i Deala. */
export type WebsiteSource = {
  website?: unknown;
  website_status?: unknown;
  lead_score_breakdown?: unknown;
  score_breakdown?: unknown;
  props?: unknown;
};

export type WebsiteInfo = {
  /** Klikalny adres (ze schematem) albo null, gdy adresu nie znamy. */
  url: string | null;
  /** Adres do wyświetlenia (bez schematu i „www."). */
  host: string | null;
  /** Rozstrzygnięty stan; 'unknown' = brak jakichkolwiek danych o stronie. */
  status: WebsiteStatus | "unknown";
  /** Czy firma ma stronę: true / false / null (nie wiadomo). */
  hasWebsite: boolean | null;
  /** Gotowy tekst do UI: adres, etykieta statusu albo „—". */
  label: string;
  /** Dopisek dla tooltipa, np. status przy działającym linku. */
  statusLabel: string | null;
};

/**
 * Scala wszystkie źródła w jeden spójny opis stanu strony. Używać W KAŻDYM
 * miejscu UI, które pokazuje kolumnę/pole „Strona" — dzięki temu tabela,
 * szuflada i tryb dzwonienia nigdy nie mówią trzech różnych rzeczy o tym
 * samym rekordzie.
 */
export function websiteInfo(p: WebsiteSource | null | undefined): WebsiteInfo {
  const url = normalizeWebsiteUrl(p?.website);
  const stored = normalizeWebsiteStatus(p?.website_status);
  const props = (p?.props ?? null) as Record<string, unknown> | null;
  const scored = websiteStatusFromScoring(
    p?.lead_score_breakdown ?? p?.score_breakdown,
    props?.score_reasons
  );

  let status: WebsiteStatus | "unknown" = stored ?? scored ?? "unknown";
  // Sprzeczność: mamy działający adres, a zapisany status mówi „brak strony"
  // (typowe dla rekordów, gdzie status pochodzi ze starszego przebiegu
  // scrapera). Adres jest twardszym dowodem — status ignorujemy.
  if (url && status === "none") status = "unknown";

  const hasWebsite = url ? true : status === "unknown" ? null : status !== "none";
  const statusLabel = status === "unknown" ? null : WEBSITE_STATUS_LABEL[status];

  return {
    url,
    host: url ? websiteHost(url) : null,
    status,
    hasWebsite,
    label: url ? websiteHost(url) : (statusLabel ?? "—"),
    statusLabel,
  };
}

/**
 * Wartość statusu do ZAPISU w bazie przy imporcie ze scrapera. Gdy scraper nie
 * przysłał statusu, wyprowadzamy go z obecności adresu (konwencja scrapera:
 * puste `website` = brak strony). Zwraca undefined, gdy nie mamy podstaw, by
 * cokolwiek zapisać — wtedy kolumny nie ruszamy.
 */
export function websiteStatusForWrite(
  rawStatus: unknown,
  url: string | null,
  websiteFieldPresent: boolean
): WebsiteStatus | undefined {
  const normalized = normalizeWebsiteStatus(rawStatus);
  if (normalized) return normalized;
  if (websiteFieldPresent && !url) return "none";
  return undefined;
}
