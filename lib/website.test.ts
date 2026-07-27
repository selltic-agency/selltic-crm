// Test regresyjny kolumny „Strona" w Prospectingu — najczęstsze kształty danych
// ze scrapera (adres bez schematu, pusty string, status po polsku, sam opis ze
// scoringu). Uruchomienie: npm test
import assert from "node:assert";
import {
  normalizeWebsiteStatus,
  normalizeWebsiteUrl,
  websiteHost,
  websiteInfo,
  websiteStatusFromScoring,
  websiteStatusForWrite,
} from "./website.ts";

// ── normalizeWebsiteStatus ────────────────────────────────────────────────
assert.equal(normalizeWebsiteStatus("brak"), "none");
assert.equal(normalizeWebsiteStatus("BRAK STRONY"), "none");
assert.equal(normalizeWebsiteStatus("dziala"), "active");
assert.equal(normalizeWebsiteStatus("działa"), "active");
assert.equal(normalizeWebsiteStatus("nie_dziala"), "broken");
assert.equal(normalizeWebsiteStatus("nie działa"), "broken");
assert.equal(normalizeWebsiteStatus("wolna"), "slow");
assert.equal(normalizeWebsiteStatus("active"), "active");
assert.equal(normalizeWebsiteStatus(null), null);
assert.equal(normalizeWebsiteStatus(""), null);
assert.equal(normalizeWebsiteStatus("cokolwiek"), null);

// ── normalizeWebsiteUrl ───────────────────────────────────────────────────
// Adres bez schematu MUSI dostać https — inaczej <a href> linkuje względnie
// wewnątrz CRM-u i „strona" prowadzi donikąd.
assert.equal(normalizeWebsiteUrl("rozakwiaty.pl"), "https://rozakwiaty.pl/");
assert.equal(normalizeWebsiteUrl("www.rozakwiaty.pl"), "https://www.rozakwiaty.pl/");
assert.equal(normalizeWebsiteUrl("//rozakwiaty.pl"), "https://rozakwiaty.pl/");
assert.equal(normalizeWebsiteUrl("  http://rozakwiaty.pl/oferta  "), "http://rozakwiaty.pl/oferta");
assert.equal(normalizeWebsiteUrl('"https://salon.pl"'), "https://salon.pl/");
// Placeholdery i śmieci = brak adresu, nie „strona o nazwie brak".
assert.equal(normalizeWebsiteUrl(""), null);
assert.equal(normalizeWebsiteUrl("   "), null);
assert.equal(normalizeWebsiteUrl("brak"), null);
assert.equal(normalizeWebsiteUrl("-"), null);
assert.equal(normalizeWebsiteUrl("—"), null);
assert.equal(normalizeWebsiteUrl("n/a"), null);
assert.equal(normalizeWebsiteUrl("null"), null);
assert.equal(normalizeWebsiteUrl("kontakt@salon.pl"), null);
assert.equal(normalizeWebsiteUrl("mailto:kontakt@salon.pl"), null);
assert.equal(normalizeWebsiteUrl("localhost"), null);
assert.equal(normalizeWebsiteUrl(null), null);
assert.equal(normalizeWebsiteUrl(123), null);

// ── websiteHost ───────────────────────────────────────────────────────────
assert.equal(websiteHost("https://www.rozakwiaty.pl/"), "rozakwiaty.pl");
assert.equal(websiteHost("https://rozakwiaty.pl/oferta/"), "rozakwiaty.pl/oferta");

// ── websiteStatusFromScoring ──────────────────────────────────────────────
assert.equal(
  websiteStatusFromScoring({ stan_strony: { punkty: 40, opis: "Brak strony/domeny" } }),
  "none"
);
assert.equal(
  websiteStatusFromScoring({ stan_strony: { punkty: 25, opis: "Strona nie działa" } }),
  "broken"
);
assert.equal(
  websiteStatusFromScoring({ stan_strony: { punkty: 5, opis: "Strona działa" } }),
  "active"
);
// Pozycje niezwiązane ze stroną nie mogą niczego rozstrzygać.
assert.equal(websiteStatusFromScoring({ opinie: { punkty: 12, opis: "≥ 15 opinii" } }), null);
// Stary format: props.score_reasons jako lista stringów.
assert.equal(websiteStatusFromScoring(null, ["≥ 4.0 oceny", "Brak strony"]), "none");
assert.equal(websiteStatusFromScoring(null, null), null);

// ── websiteInfo: scalanie źródeł ──────────────────────────────────────────
// 1. Sam adres, bez statusu (najczęstszy rekord ze scrapera) → klikalny link.
{
  const info = websiteInfo({ website: "rozakwiaty.pl" });
  assert.equal(info.url, "https://rozakwiaty.pl/");
  assert.equal(info.host, "rozakwiaty.pl");
  assert.equal(info.label, "rozakwiaty.pl");
  assert.equal(info.hasWebsite, true);
}

// 2. Adres + sprzeczny status 'none' → adres wygrywa, nie pokazujemy „Brak strony".
{
  const info = websiteInfo({ website: "https://salon.pl", website_status: "none" });
  assert.equal(info.hasWebsite, true);
  assert.equal(info.label, "salon.pl");
  assert.equal(info.status, "unknown");
}

// 3. Pusty string w `website` + status 'brak' (scraperowa konwencja) → „Brak strony".
{
  const info = websiteInfo({ website: "", website_status: "brak" });
  assert.equal(info.url, null);
  assert.equal(info.hasWebsite, false);
  assert.equal(info.label, "Brak strony");
}

// 4. Brak adresu i statusu, ale scoring wie, że strona jest i nie działa.
{
  const info = websiteInfo({
    website: null,
    website_status: null,
    lead_score_breakdown: { stan_strony: { punkty: 25, opis: "Strona nie działa" } },
  });
  assert.equal(info.status, "broken");
  assert.equal(info.hasWebsite, true);
  assert.equal(info.label, "Zepsuta");
}

// 5. Scoring mówi „Brak strony/domeny" → jednoznaczne „Brak strony".
{
  const info = websiteInfo({
    lead_score_breakdown: { stan_strony: { punkty: 40, opis: "Brak strony/domeny" } },
  });
  assert.equal(info.status, "none");
  assert.equal(info.hasWebsite, false);
  assert.equal(info.label, "Brak strony");
}

// 6. Puste kolumny → „Brak strony". Dane pochodzą z Google Maps, gdzie adres
//    jest podany zawsze, gdy firma go ma, więc pustka = firma nie ma strony.
//    Jeden komunikat w całym CRM-ie, bez osobnego „brak danych".
{
  const info = websiteInfo({ website: null, website_status: null });
  assert.equal(info.status, "none");
  assert.equal(info.hasWebsite, false);
  assert.equal(info.label, "Brak strony");
}
assert.equal(websiteInfo(null).label, "Brak strony");
// Pusty string i placeholder w kolumnie `website` dają to samo co NULL.
assert.equal(websiteInfo({ website: "" }).label, "Brak strony");
assert.equal(websiteInfo({ website: "   " }).label, "Brak strony");
assert.equal(websiteInfo({ website: "brak" }).label, "Brak strony");

// 7. Stary rekord z props.score_reasons.
{
  const info = websiteInfo({ props: { score_reasons: ["Brak strony/domeny", "12 opinii"] } });
  assert.equal(info.status, "none");
}

// 8. ScrapedLead (score_breakdown zamiast lead_score_breakdown, status po polsku).
{
  const info = websiteInfo({ website: "salon.pl", website_status: "dziala" });
  assert.equal(info.status, "active");
  assert.equal(info.statusLabel, "Aktywna");
  assert.equal(info.label, "salon.pl");
}
{
  const info = websiteInfo({ score_breakdown: { stan_strony: { punkty: 5, opis: "Strona działa" } } });
  assert.equal(info.status, "active");
}

// ── websiteStatusForWrite (import) ────────────────────────────────────────
// Scraper przysyła polskie wartości — do bazy musi trafić enum z CHECK-a.
assert.equal(websiteStatusForWrite("brak", null, true), "none");
assert.equal(websiteStatusForWrite("nie_dziala", "https://salon.pl/", true), "broken");
// Brak statusu + jawnie pusty `website` = brak strony (konwencja scrapera).
assert.equal(websiteStatusForWrite(null, null, true), "none");
// Brak statusu + adres → nie zgadujemy „aktywna", zostawiamy kolumnę bez zmian.
assert.equal(websiteStatusForWrite(null, "https://salon.pl/", true), undefined);
// Pole `website` w ogóle nie przyszło → nie ruszamy statusu.
assert.equal(websiteStatusForWrite(null, null, false), undefined);

console.log("OK lib/website.test.ts");
