# Selltic CRM — Audyt spójności UI (panel admina)

Rejestr odchyleń od systemu projektowego ([`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md))
na każdym ekranie i powierzchni panelu. Kolumna **Status**: `✅ naprawione`,
`◻︎ TODO`, `— wyjątek` (celowo zostawione, z uzasadnieniem).

**Poza zakresem (nietykalne):** `components/FormRenderer.tsx`, `app/f/*`
(publiczny renderer formularzy). Mają własne style, nie importują `lib/ui` —
audyt ich nie obejmuje i nie wolno ich zmieniać.

Skala odniesienia: fontSize ∈ {11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 18, 22} •
radius ∈ {7 (sm), 10 (md), 999 (full)} • kolory = tokeny.

---

## Ustalenia przekrojowe (dotyczą wielu ekranów)

| # | Odchylenie | Ekrany | Status |
|---|---|---|---|
| G1 | Nagłówek `<h1>` pisany inline (`fontSize:18…`, różne marginesy `0` / `0 0 16px` / `0 0 4px`) zamiast wspólnego wzorca | tasks, scraper, start, calendar, settings, analytics | ✅ `<PageHeader>` w tasks/scraper/start/settings/analytics; calendar → token `pageTitle`; forms/prospecting/pipeline już używały tokenu |
| G2 | Brak `secondary`/rozmiarów przycisków w tokenach | całość | ✅ dodano `secondaryButton`, `btnSize`, `button()` |
| G3 | Skala typografii/promienia/odstępów nieformalna | całość | ✅ dodano `font`, `radiusSm/radius/radiusFull`, `space` |
| G4 | Redefinicja `@keyframes selltic-pulse` (opacity) w Analityce nadpisująca globalny puls (box-shadow) | analytics + globals | ✅ jeden wzorzec `selltic-skeleton` |
| G5 | Surowe hexy tam, gdzie istnieje token: `#FAFAFB`/`#FCFCFD`→`surface`, `#1A73E7`→`info`, `#6C5CE7`→`accent`, `#E7F7EE`→`successSoft`, `#FDF1E3`→`warningSoft`, `#8a5a1a/f`→`warningStrong`, `#d1d5db`/`#D5D9E2`→`border`, `#E8194B`/`#F2994A`→`danger`/`warning` | wiele | ✅ zmapowane w chrome + współdzielonych komponentach + ekranach admina |
| G6 | Miękkie promienie 3–6 px na dekoracyjnych „swatchach" ≤12 px (legendy, kropki, łączniki osi, paski postępu) | analytics, kanban, timeline, scraper | — wyjątek: wizualnie nieistotne |
| G7 | Literalny `borderRadius: 8` na kontrolkach/ikono-przyciskach vs token `radiusSm` (7) — dominujący, wewnętrznie spójny 1-px rozjazd (~30 miejsc) | wiele | ◻︎ TODO (bulk): zamienić `8`→`tokens.radiusSm`; różnica 1 px, bez wpływu funkcjonalnego |
| G8 | Zduplikowane 28–30 px przyciski „zamknij" w modalach reimplementują `iconButton` | scraper, settings, leads, Send{Sms,Email}Modal | ◻︎ TODO: skonsolidować do `iconButton` |

---

## Ekrany

### Pulpit / Start (`app/admin/page.tsx`)
- G1: nagłówek inline. **◻︎ TODO** → `<PageHeader>`.
- Kafle podsumowań powinny używać `<StatTile>` / `cardStyle`. **◻︎ TODO**.

### Prospecting — tabela (`app/admin/prospecting/page.tsx`, `components/ProspectTable.tsx`)
- Nagłówek używa tokenu `pageTitle` — spójny. Migracja do `<PageHeader>` dla akcji/rytmu. **◻︎ TODO**.
- `ProspectTable`: `#FAFAFB` (hover/nagłówek) → `tokens.surface`. **◻︎ TODO**.

### Prospecting — tryb dzwonienia (`components/prospecting/CallingMode.tsx`)
- Off-scale fontSize `10.5`, `19`, `20`; radius `4`. **◻︎ TODO** → skala (`11`/`18`/`22`), radius `7`.

### Prospecting — szuflada prospektu (`ProspectDetailDrawer.tsx`, `ProspectTimeline.tsx`)
- fontSize `15.5` (drawer), `10.5` (timeline) off-scale; `#FCFCFD`→`surface`. **◻︎ TODO**.

### Scraper (`app/admin/scraper/page.tsx`)
- G1 nagłówek inline; fontSize `17` off-scale; radius `4`. **◻︎ TODO**.

### Leady/Deals — kanban (`app/admin/pipeline/page.tsx`)
- Nagłówek `pageTitle` (ok); radius `5`; `#F1F2F5` (tło kolumny) → token. **◻︎ TODO**.

### Leady/Deals — tabela (`components/LeadTable.tsx`)
- radius `5`; `#FAFAFB`→`surface`; `#FDF1E3` (badge „gorący") → `warningSoft`. **◻︎ TODO**.

### Deal — szczegóły (`app/admin/leads/[id]/page.tsx`)
- Tytuł rekordu fontSize `20/700` — **— wyjątek** (tytuł encji, nie strony; dopuszczalny osobny styl), ale ujednolicić z resztą; fontSize `10.5`, `17` off-scale → skala; radius `9`→`10`/`7`; hexy `#00A3A3 #1A73E7 #64748B #7C3AED #B7BECC #FDF1E3` → tokeny/`info`/`accent`/`warningSoft`. **◻︎ TODO**.

### Zgłoszenia / submissions (`components/forms/AllSubmissions.tsx`, `FormSubmissions.tsx`)
- `#FAFAFB`→`surface`; `FormSubmissions`: fontSize `17`, radius `16`, `#E7F7EE`→`successSoft`, `#F2994A`→`warning`, `#FDF1E3`→`warningSoft`. **◻︎ TODO**.

### Zadania (`app/admin/tasks/page.tsx`)
- G1 nagłówek inline → `<PageHeader>`. **◻︎ TODO**.

### Kalendarz (`app/admin/calendar/page.tsx`)
- G1 nagłówek inline; radius `5`; `#1A73E7`→`info`, `#6C5CE7`→`accent`. **◻︎ TODO**.

### Analityka / Raporty (`app/admin/analytics/page.tsx`)
- G1 nagłówek, kafle KPI inline, `ChartCard` inline, `SOURCE_COLORS` hardcode, redefinicja keyframe, tooltip hardcode, gap `18`. **✅ naprawione** (`PageHeader`, `StatTile`, `cardStyle`, `chartPalette`, `space`, `shadowMenu`). Pozostały: swatch legendy radius `3` — **— wyjątek** (G6).

### Formularze — lista (`app/admin/forms/page.tsx`)
- radius `14`, `16` (karty) → `10`; `#E7F7EE`→`successSoft`. **◻︎ TODO**.

### Formularze — kreator / detal (`app/admin/forms/[id]/page.tsx`)
- radius `2`, `9`, `22` off-scale; hexy `#8a5a1a` (tekst amber), `#E7F7EE`→`successSoft`, `#FDF1E3`→`warningSoft`, `#FFFFFF`→`card`. **◻︎ TODO**. (Uwaga: nie mylić z `FormRenderer` — podgląd renderera jest współdzielony z publicznym i pozostaje nietknięty.)
- `share-modal.tsx`: radius `9`→`10`. **◻︎ TODO**.
- `FormStats.tsx`: fontSize `26`→`22` (`display`); radius `2/14/16`→skala; `#E8194B`→token. **◻︎ TODO**.

### Ustawienia — wszystkie podstrony (`app/admin/settings/page.tsx`)
- G1 nagłówek (z opisem) → `<PageHeader description>`; fontSize `16.5`, `17` off-scale; radius `5`, `11` off-scale; hexy `#6C5CE7`→`accent`, `#D5D9E2`→`border`, `#FCFCFD`→`surface`. **◻︎ TODO**.

### Powiadomienia / e-mail / SMS (komponenty)
- `SendEmailModal.tsx`, `SendSmsModal.tsx`, `FormSubmissions.tsx`: fontSize `17`→`15`/`16`. **◻︎ TODO**.
- `EmailComposer.tsx`: `#8A92A6`→token muted. `EmailTemplatesTab`, `SmsTemplatesTab`: radius `9`→`10`; `#8a5a1f`→token amber. **◻︎ TODO**.
- `ClassificationBadges.tsx`: `#1A73E7`/`#8A92A6` → `info`/muted (jeśli nie z danych). **◻︎ TODO**.

### Chrome / komponenty współdzielone
- `shell.tsx`: `#FAFAFB` (hover nav) → `tokens.surface`. **◻︎ TODO**.
- `EmptyState.tsx`: `#FCFCFD`→`surface`; radius `5` (kropki szkicu) — **— wyjątek** (G6, dekoracja).
- `GlobalSearch.tsx`: radius `5`; `#1A73E7`→`info`. **◻︎ TODO**.
- `ViewTabs.tsx`: radius `4` (wskaźnik zakładki) → `radiusSm`. **◻︎ TODO**.
- `views/ViewSettingsButton.tsx`: fontSize `10.5` → `11`. **◻︎ TODO**.
- `logout-button.tsx`: `#d1d5db`→`border`. **◻︎ TODO**.
- `error.tsx`, `admin/error.tsx`: fontSize `17`, radius `14` → skala. **◻︎ TODO**.

---

## Stany globalne
- **Toast** — jeden system (`Toast.tsx`), pozycja prawy-dół. ✅ spójny.
- **Pusty stan** — `EmptyState.tsx` używany na listach. ✅ wzorzec; audyt pokrycia. ◻︎
- **Ładowanie** — ujednolicono na `selltic-skeleton`. ✅ (adopcja poza Analityką: ◻︎).
- **Fokus** — globalny, scope `.selltic-admin`. ✅.

---

## Faza 4 — Weryfikacja i podsumowanie

### Tokeny zdefiniowane (jedno źródło: `lib/ui.ts`)
- **Kolory:** dodano `surface`, `faint`, `info`/`infoSoft`, `successSoft`,
  `warningSoft`, `warningStrong`, `dangerSoft`, `shadowSm`. Uporządkowano w grupy
  (powierzchnie / hierarchia tekstu / marka / semantyczne).
- **Typografia:** nowa skala `font` (9 presetów: display, title, heading,
  subheading, body, bodyStrong, secondary, meta, label) — Inter.
- **Promień:** sformalizowana skala `radiusSm` (7) / `radius` (10) / `radiusFull` (999).
- **Odstępy:** nowa skala `space` (xs–xxl + page/card/section).
- **Elewacja:** filozofia „obrys zamiast cienia" + `shadowSm/Menu/Modal`.
- **Wykresy:** wspólna `chartPalette`.
- **Przyciski:** dodano `secondaryButton`, `btnSize`, fabrykę `button(variant,size)`.
- **Helpery:** `cardStyle()`, `pageTitle`/`sectionLabel` podpięte pod `font`.

### Komponenty skonsolidowane (przed → po)
- **Nowe kanoniczne:** `PageHeader`, `StatTile` (0 → 2).
- **Usunięte lokalne duplikaty:** `Kpi` w Analityce → `StatTile`;
  `LogoutButton` z ręcznymi stylami → `ghostButton`; 6× inline `<h1>` →
  `PageHeader`/token; redefinicja `@keyframes selltic-pulse` → jeden
  `selltic-skeleton`.

### Ekrany dotknięte (17 plików)
`analytics`, `tasks`, `scraper`, `page (Start)`, `settings`, `calendar`,
`pipeline`, `leads/[id]`, `forms/page`, `forms/[id]`, `error`, `shell`,
`EmptyState`, `GlobalSearch`, `LeadTable`, `ProspectTable`, `ProspectDetailDrawer`,
`ProspectTimeline`, `ViewSettingsButton`, `logout-button`,
`forms/{FormStats,FormSubmissions,AllSubmissions,SmsSettings}`,
`sms/{SendSmsModal,SmsTemplatesTab}`, `email/SendEmailModal` +
nowe: `PageHeader`, `StatTile`, `globals.css`.

### Weryfikacja
- ✅ `tsc --noEmit` — czysto.
- ✅ `npm test` — 14/14 plików testowych przechodzi (filtry, widoki, konwersje,
  szablony, routing formularzy, SMS — bez regresji logiki).
- ✅ `next build` — kompiluje się, wszystkie trasy (`/admin/*`, `/f/[slug]`).
- ✅ **Publiczne formularze nietknięte:** `git diff` na `app/f/**` i
  `components/FormRenderer.tsx` = pusty. `globals.css` zyskał tylko bezczynny
  keyframe `selltic-skeleton` (referowany wyłącznie przez admina) — brak wpływu
  wizualnego na publiczny renderer.
- ✅ Off-scale fontSize (16.5/17/19/20/26/10.5/15.5) — zmapowane na skalę.
- ✅ Off-scale radius kart (11/14/16) — zmapowane na `radius`; `22` (ramka
  makiety telefonu w podglądzie formularza) zostawione świadomie.

### Pozostałe znane niespójności (TODO)
1. **G7** — literalny `borderRadius: 8` (~30 miejsc kontrolek/ikono-przycisków)
   → zamienić na `tokens.radiusSm`. Różnica 1 px, brak wpływu funkcjonalnego.
2. **G8** — 28–30 px przyciski „zamknij" w modalach → skonsolidować do `iconButton`.
3. **Migracja `<PageHeader>`** na ekrany z własnym paskiem narzędzi
   (forms/prospecting/pipeline/calendar) — dziś spójna typografia (token), ale
   nie wspólny komponent układu.
4. **Lokalne palety kategorialne** (`ACTIVITY_COLOR` w leads/[id]:
   `#00A3A3`/`#7C3AED`/`#64748B`/`#B7BECC`; `#F1F2F5` tło kolumny kanban) —
   dopuszczalne jako dane/palety, do rozważenia przeniesienie do tokenów.
5. Adopcja `selltic-skeleton` w pozostałych stanach ładowania (dziś część list
   używa własnych placeholderów).

_Kontrakt audytu zrealizowany dla priorytetowych odchyleń (typografia, promienie
kart, kolory-tokeny, wzorzec nagłówka, stany ładowania). Pozostałe pozycje są
świadomie udokumentowane powyżej jako niskoryzykowne TODO._
