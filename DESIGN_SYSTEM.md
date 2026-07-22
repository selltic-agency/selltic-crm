# Selltic CRM — System projektowy (Design System)

Jedno źródło prawdy dla wyglądu **panelu admina** (`/admin/*`). Styl inspirowany
Attio: neutralne, jasne UI, subtelne szare obrysy zamiast cieni, mały promień
zaokrąglenia, kompaktowe kontrolki, jeden wyraźny kolor akcentu.

> **Zakres.** Te zasady i tokeny stylują **wyłącznie panel admina**. Publiczny
> renderer formularzy (`components/FormRenderer.tsx`, `app/f/*`,
> `go.selltic-agency.pl`, embedy) ma **własne, odrębne style** i **nie importuje**
> `lib/ui`. Zmiany w tym dokumencie i w `lib/ui.ts` nie mogą wyciekać do
> publicznych formularzy.

## Mechanizm

Panel nie używa Tailwinda — style są **inline** (`style={{…}}`) i odwołują się do
**tokenów TypeScript** w [`lib/ui.ts`](lib/ui.ts). To jest jedyny mechanizm
tokenów. Nowy kod **nie** wprowadza wartości spoza skali (żadnych
`fontSize: 17`, `borderRadius: 14`, surowych hexów, gdy istnieje token).

Import: `import { tokens, font, space, ... } from "@/lib/ui";`

---

## 1. Kolory (`tokens`)

| Token | Wartość | Zastosowanie |
|---|---|---|
| `bg` | `#F7F7F8` | tło aplikacji, hover wierszy, delikatne wypełnienia |
| `card` | `#FFFFFF` | powierzchnia kart, paneli, modali |
| `surface` | `#FAFAFB` | zagłębione tło: nagłówki tabel, pola read-only, hover |
| `border` | `#E5E6EB` | obrys kart, pól, tabel |
| `borderSoft` | `#EEEFF2` | separatory wierszy, linie wewnętrzne |
| `text` | `#17181C` | tekst podstawowy (poziom 1) |
| `muted` | `#75798A` | tekst drugorzędny / meta (poziom 2) |
| `faint` | `#9AA0B0` | placeholdery, „—", wyłączone (poziom 3) |
| `accent` | `#6C5CE7` | marka / akcja główna / stan aktywny |
| `accentSoft` | `rgba(108,92,231,.09)` | miękkie tło akcentu (ikony KPI, kursor wykresu) |
| `success` / `successSoft` | `#18A957` | powodzenie, „Wygrane", „Skonwertowany" |
| `warning` / `warningSoft` | `#F2994A` | ostrzeżenie, „Nie odbiera" |
| `warningStrong` | `#8A5A1A` | ciemny amber do TEKSTU/obrysu na `warningSoft` (kontrast) |
| `danger` / `dangerSoft` | `#E5484D` | błąd, akcja destrukcyjna, „Niezainteresowany" |
| `info` / `infoSoft` | `#1A73E7` | informacja, neutralny akcent (drugorzędny na wykresach) |

Kolory semantyczne mają wariant `…Soft` (przezroczyste tło) do badge/chipów/alertów.
**Nie** wpisujemy tych hexów ręcznie — używamy tokenu.

**Statusy** (jedno mapowanie w całej aplikacji): `lib/prospectStatus.ts`
→ `STATUS_COLOR`. Np. „Nowy" = `accent`, „Nie odbiera" = `warning`,
„Niezainteresowany" = `danger`, „Skonwertowany" = `success`. Kolory etapów lejka
i kategorii branż są **danymi** konfigurowalnymi przez użytkownika (seed:
`lib/types.ts`) — to celowo paleta kategorialna, nie tokeny stylu.

**Wykresy:** paleta kategorialna `chartPalette` (stała kolejność) z `lib/ui.ts`.

## 2. Typografia (`font`) — Inter wszędzie

Każdy tekst mapuje się na **jeden** preset. Poza skalą nie ma arbitralnych rozmiarów.

| Preset | Rozmiar / waga | Zastosowanie |
|---|---|---|
| `font.display` | 22 / 700 | duża liczba KPI, wartość kafla |
| `font.title` | 18 / 600 | tytuł strony (`<h1>`) — jeden na widok |
| `font.heading` | 15 / 600 | nagłówek sekcji / karty / modala (`<h2>`) |
| `font.subheading` | 14 / 600 | tytuł mniejszej karty, pod-nagłówek |
| `font.body` | 13 / 400 | tekst podstawowy, wiersze tabel, pola |
| `font.bodyStrong` | 13 / 600 | nazwy rekordów, wartości |
| `font.secondary` | 12 / 400 | opisy, podpisy, meta drugiego rzędu |
| `font.meta` | 11.5 / 500 | tekst badge/chip, nagłówki tabel, drobne meta |
| `font.label` | 11 / 600 UPPER | etykiety grup/sekcji (wersaliki) |

## 3. Promień (skala 3-elementowa)

| Token | px | Zastosowanie |
|---|---|---|
| `tokens.radiusSm` | 7 | kontrolki: przyciski, pola, selecty, chipy, ikony-przyciski |
| `tokens.radius` | 10 | karty, panele, modale, dropdowny, kafle KPI |
| `tokens.radiusFull` | 999 | awatary, kropki statusu, paski postępu, przełączniki |

## 4. Odstępy (`space`, skala 4-punktowa)

`xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24`, plus semantyczne:
`space.page 24` (padding treści = `.selltic-main`), `space.card 16` (padding kart),
`space.section 16` (odstęp między sekcjami). Wysokość wiersza tabeli i gęstość
pól: patrz `thStyle`/`tdStyle`/`inputStyle`.

## 5. Elewacja — „obrys zamiast cienia"

Karty i panele używają **obrysu** (`1px solid tokens.border`), nie cienia. Cienie
wyłącznie dla elementów **pływających** nad treścią:
`tokens.shadowSm` (subtelny), `tokens.shadowMenu` (dropdowny/menu/toasty),
`tokens.shadowModal` (modale/szuflady).

## 6. Kanoniczne komponenty i warianty

Preferuj **współdzielony komponent** zamiast lokalnego stylu.

- **Przyciski** — `button(variant, size)` lub gotowce `primaryButton` /
  `secondaryButton` / `ghostButton` / `dangerButton`. Rozmiary `btnSize`:
  `sm` (26px) / `md` (30px, domyślny) / `lg` (36px, CTA / puste stany).
  Kolejność w stopkach: drugorzędny **po lewej**, główny **po prawej**.
- **Pola / selecty** — `inputStyle`. Fokus: obrys akcentu (globalny,
  `globals.css` scope `.selltic-admin`).
- **Ikony-przyciski** — `iconButton` (28px, z obrysem) / `bareIconButton`
  (26px, bez obrysu, w gęstych wierszach).
- **Chipy / badge** — `chipStyle(color?)`. Jedna wysokość, promień `radiusSm`,
  spójne mapowanie statusów.
- **Karty / kafle** — `cardStyle(pad?)`; kafel KPI: [`<StatTile>`](components/StatTile.tsx).
- **Nagłówek strony** — [`<PageHeader>`](components/PageHeader.tsx): tytuł +
  opcjonalny opis + akcja główna po prawej + opcjonalny rząd zakładek. Ten sam
  rytm pionowy na każdym widoku.
- **Tabele** — `thStyle` / `tdStyle` (wspólna gęstość); pasek akcji masowych:
  `components/BulkEditBar.tsx`.
- **Panel pływający** (dropdown/menu/popover) — `menuPanel`.
- **Ikony** — **wyłącznie** Material Symbols (styl outlined) przez
  [`<MIcon>`](components/MaterialIcon.tsx). Rozmiary: 18–20 w nawigacji/przyciskach,
  16 inline, 15 w drobnych kontrolkach. **Zakaz** innych zestawów (lucide itd.).
- **Toast** — jeden system: `useToast()` (`components/Toast.tsx`), pozycja
  prawy-dół, `shadowMenu`.
- **Pusty stan** — jeden wzorzec: [`<EmptyState>`](components/EmptyState.tsx).
- **Ładowanie** — jeden wzorzec **skeleton** (keyframe `selltic-skeleton` w
  `globals.css`), nie spinnery (poza przyciskiem „Odśwież": `selltic-spin`).

## 7. Fokus i dostępność

Widoczne pierścienie fokusu pochodzą z tokenów i są zdefiniowane globalnie w
`app/globals.css` (scope `.selltic-admin`, nie wyciekają do publicznych
formularzy). Elementy interaktywne mają stany hover / active / disabled
wyprowadzone z tych samych reguł. Respektujemy `prefers-reduced-motion`.

---

_Ten dokument opisuje stan po ujednoliceniu. Szczegółowy rejestr odchyleń i ich
statusu: [`UI_AUDIT.md`](UI_AUDIT.md)._
