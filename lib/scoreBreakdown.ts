// lib/scoreBreakdown.ts — wspólne parsowanie i formatowanie rozbicia lead score.
//
// Źródłem prawdy jest `score_breakdown` (scraped_leads) / `lead_score_breakdown`
// (prospects/deals) zapisane przez backend scrapera z funkcji score_website().
// Kształt: { <klucz>: { punkty: number, opis: string } }, np.
//   {
//     "stan_strony": { "punkty": 40, "opis": "Brak strony/domeny" },
//     "opinie":      { "punkty": 12, "opis": "≥ 15 opinii" },
//     "ocena":       { "punkty": 10, "opis": "≥ 4.0 oceny" }
//   }
//
// Celowo NIE liczymy punktów w frontendzie od nowa — pokazujemy dokładnie to,
// co scorer zapisał (spójne z wagami/regułami z scraper_config obowiązującymi
// w chwili scrapowania). Suma pozycji = wynik zapisany w kolumnie score.

export type ScoreBreakdownItem = {
  label: string; // czytelny opis pozycji (np. "Brak strony/domeny")
  points: number | null; // wkład punktowy; null gdy pochodzi z fallbacku bez liczby
};

export type ParsedBreakdown = {
  items: ScoreBreakdownItem[];
  total: number | null; // suma punktów pozycji (null gdy nie da się policzyć)
};

// Kolejność wyświetlania — najpierw stan strony, potem bonus, opinie, ocena,
// a nieznane klucze na końcu w kolejności napotkania.
const KEY_ORDER = ["stan_strony", "niemobilna", "opinie", "ocena"];

function isBreakdownEntry(v: unknown): v is { punkty: number; opis?: string } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { punkty?: unknown }).punkty === "number" &&
    Number.isFinite((v as { punkty: number }).punkty)
  );
}

/**
 * Parsuje zapisane rozbicie score na uporządkowaną listę pozycji + sumę.
 * @param breakdown  wartość kolumny score_breakdown / lead_score_breakdown (jsonb)
 * @param fallbackReasons  opcjonalne stare `props.score_reasons` (lista stringów),
 *                         używane tylko gdy brak strukturalnego rozbicia
 */
export function parseScoreBreakdown(
  breakdown: unknown,
  fallbackReasons?: unknown
): ParsedBreakdown {
  if (breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)) {
    const entries = Object.entries(breakdown as Record<string, unknown>).filter(([, v]) =>
      isBreakdownEntry(v)
    );
    if (entries.length > 0) {
      entries.sort(([a], [b]) => {
        const ia = KEY_ORDER.indexOf(a);
        const ib = KEY_ORDER.indexOf(b);
        return (ia === -1 ? KEY_ORDER.length : ia) - (ib === -1 ? KEY_ORDER.length : ib);
      });
      const items: ScoreBreakdownItem[] = entries.map(([key, v]) => {
        const entry = v as { punkty: number; opis?: string };
        return { label: entry.opis?.trim() || key, points: entry.punkty };
      });
      const total = items.reduce((sum, it) => sum + (it.points ?? 0), 0);
      return { items, total };
    }
  }

  // Fallback: stare rekordy bez strukturalnego rozbicia mogą mieć listę powodów.
  if (Array.isArray(fallbackReasons)) {
    const items = fallbackReasons
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => ({ label: r.trim(), points: null }));
    if (items.length > 0) return { items, total: null };
  }

  return { items: [], total: null };
}

// Formatuje pojedynczą pozycję jako "opis: +40 pkt" (albo "opis: 0 pkt", albo
// bez punktów gdy nieznane).
export function formatBreakdownItem(item: ScoreBreakdownItem): string {
  if (item.points == null) return item.label;
  const sign = item.points > 0 ? "+" : "";
  return `${item.label}: ${sign}${item.points} pkt`;
}

// Jednolinijkowe podsumowanie, np.
// "Brak strony/domeny: +40 pkt · ≥ 15 opinii: +12 pkt · ≥ 4.0 oceny: +10 pkt = 62/100".
export function formatBreakdownLine(parsed: ParsedBreakdown, score: number | null): string {
  const parts = parsed.items.map(formatBreakdownItem);
  const body = parts.join(" · ");
  const shown = score ?? parsed.total;
  if (shown == null) return body;
  return body ? `${body} = ${shown}/100` : `${shown}/100`;
}
