# Publikowanie formularzy na subdomenie `go.selltic-agency.pl`

Opublikowane formularze mogą być serwowane pod dedykowaną, brandowaną
subdomeną (np. `https://go.selltic-agency.pl/<slug>`) zamiast ścieżki
`/<domena-aplikacji>/f/<slug>`. Kod jest już przygotowany — pozostaje
konfiguracja domeny i jednej zmiennej środowiskowej.

## Jak to działa

- `middleware.ts` wykrywa żądania, których host = `NEXT_PUBLIC_FORMS_DOMAIN`,
  i **przepisuje** `/<slug>` na wewnętrzną trasę `/f/<slug>` (parametry,
  np. `?embed=1`, są zachowywane). Wejście na sam korzeń subdomeny
  przekierowuje na `https://selltic-agency.pl`.
- `lib/publicUrl.ts` (`publicFormUrl`) buduje linki do udostępnienia. Gdy
  subdomena jest skonfigurowana, modal „Udostępnij” pokazuje
  `https://go.selltic-agency.pl/<slug>`; w przeciwnym razie klasyczne
  `<origin>/f/<slug>`.

Bez ustawionej zmiennej wszystko działa jak dotychczas (żaden formularz się
nie psuje).

## Co musisz zrobić (jednorazowo)

1. **DNS** — u operatora domeny `selltic-agency.pl` dodaj rekord dla
   subdomeny `go`:
   - **Vercel:** `CNAME  go  →  cname.vercel-dns.com`
     (lub rekord `A`/`ALIAS` wskazany przez Vercel przy dodawaniu domeny).

2. **Domena w hostingu (Vercel)** — w projekcie: **Settings → Domains →
   Add** wpisz `go.selltic-agency.pl` i poczekaj na weryfikację + certyfikat
   SSL (dzieje się automatycznie po propagacji DNS).

3. **Zmienna środowiskowa** — w projekcie (Vercel: **Settings → Environment
   Variables**, dla środowiska Production i Preview) dodaj:

   ```
   NEXT_PUBLIC_FORMS_DOMAIN=go.selltic-agency.pl
   ```

   Do pracy lokalnej dopisz to samo do `.env.local`. Zmienna ma prefiks
   `NEXT_PUBLIC_`, bo link do udostępnienia budowany jest też po stronie
   przeglądarki — **nie** wpisuj tu żadnych sekretów.

4. **Redeploy** — po dodaniu zmiennej zrób ponowny deploy (zmienne
   `NEXT_PUBLIC_*` są wstrzykiwane w czasie budowania).

## Weryfikacja

- `https://go.selltic-agency.pl/<slug>` powinno pokazać opublikowany
  formularz (to samo co `/f/<slug>` na domenie aplikacji).
- W panelu **Kreator → Udostępnij** publiczny link i kod osadzenia iframe
  powinny używać `go.selltic-agency.pl`.
- `https://go.selltic-agency.pl/` przekierowuje na stronę główną Selltic.

## Uwagi

- Panel `/admin` pozostaje na głównej domenie aplikacji — subdomena
  `go.…` serwuje wyłącznie publiczne formularze.
- Chcesz inną subdomenę (np. `formularze.…`)? Zmień tylko wartość
  `NEXT_PUBLIC_FORMS_DOMAIN` i rekord DNS — kod jest agnostyczny.
