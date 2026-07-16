// lib/publicUrl.ts — budowanie publicznych adresów formularzy.
//
// Opublikowane formularze mogą być serwowane pod dedykowaną subdomeną
// (np. go.selltic-agency.pl) zamiast ścieżki /f/<slug> na domenie aplikacji.
// Konfiguracja przez zmienną środowiskową NEXT_PUBLIC_FORMS_DOMAIN.
//
//   NEXT_PUBLIC_FORMS_DOMAIN=go.selltic-agency.pl
//     → publiczny link:  https://go.selltic-agency.pl/<slug>
//   (pusta / brak)
//     → publiczny link:  <origin>/f/<slug>  (zachowanie sprzed subdomeny)
//
// Middleware (middleware.ts) przepisuje żądania z subdomeny na wewnętrzną
// trasę /f/<slug>, więc oba warianty renderują ten sam komponent.

// Uwaga: NEXT_PUBLIC_* jest wstrzykiwane w czasie budowania (dostępne też w
// przeglądarce), dzięki czemu link do udostępnienia można zbudować po stronie
// klienta.
export const FORMS_DOMAIN: string = (process.env.NEXT_PUBLIC_FORMS_DOMAIN || "").trim().toLowerCase();

// Czy dany host (bez portu) jest skonfigurowaną subdomeną formularzy?
export function isFormsHost(host: string | null | undefined): boolean {
  if (!FORMS_DOMAIN || !host) return false;
  return host.split(":")[0].toLowerCase() === FORMS_DOMAIN;
}

// Publiczny URL opublikowanego formularza.
// - Gdy skonfigurowano subdomenę → https://<domena>/<slug>.
// - W przeciwnym razie → <origin>/f/<slug> (origin znany dopiero w przeglądarce;
//   pusty origin daje relatywne /f/<slug>).
export function publicFormUrl(slug: string, origin?: string): string {
  if (FORMS_DOMAIN) return `https://${FORMS_DOMAIN}/${slug}`;
  const base = (origin || "").replace(/\/+$/, "");
  return `${base}/f/${slug}`;
}
