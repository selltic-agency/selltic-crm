# Facebook Lead Ads → Selltic CRM → Conversions API

Integracja działa w dwie strony:

```
  Facebook Lead Ads ──► Make.com ──► POST /api/leads/facebook ──► deal (z fb_lead_id)
        ▲                                                              │
        │                                                              ▼
        └── Conversions API ◄──────────── zmiana etapu leada w CRM ────┘
            (Qualified / Converted / Disqualified)
```

**Kierunek IN** — lead z formularza błyskawicznego trafia do CRM jako deal.
**Kierunek OUT** — gdy przesuwasz leada po lejku, CRM mówi Facebookowi, czy
lead okazał się dobry. To jest sygnał, na którym Meta uczy się dowozić lepsze
leady.

> **Dlaczego nie wysyłamy zdarzenia „Lead”:** Facebook zapisuje je sam
> w momencie wypełnienia formularza błyskawicznego. Wysłanie go drugi raz
> z CRM podwoiłoby liczenie konwersji. CRM raportuje wyłącznie **dalsze etapy
> lejka**.

---

## 1. Migracja bazy

Supabase → SQL Editor → wklej i uruchom `migration_facebook_leads.sql`.

Dodaje: kolumny `fb_*` na `deals` (z unikalnym indeksem na `fb_lead_id`),
mapowanie etapów (`pipeline_stages.meta_event_name`), tabele `fb_lead_forms`
i `meta_lead_events`, kolumny `meta_crm_*` w `app_settings` oraz opcję
„Facebook Lead Ads" we właściwości „Źródło kontaktu".

## 2. Zmienna środowiskowa

Vercel → Settings → Environment Variables:

```
FB_LEADS_KEY = <długi losowy ciąg>     # openssl rand -hex 32
```

Bez niej `/api/leads/facebook` zwraca **503** i odrzuca wszystkie leady
(świadoma blokada — endpoint jest publicznie osiągalny).

Po dodaniu zmiennej: **redeploy** (zmienne wchodzą dopiero z nowym buildem).

## 3. Co zrobić w Meta (Events Manager + Ads Manager)

### 3.1 Token Conversions API

1. **Events Manager** → wybierz zbiór danych (dataset), którego używa konto
   reklamowe prowadzące kampanie Lead Ads.
2. Zakładka **Ustawienia** → sekcja **Conversions API** → *Generuj token
   dostępu*. Skopiuj token (pokazuje się raz).
3. Zapisz sobie też **identyfikator zbioru danych** (Dataset ID) — widoczny na
   górze strony ustawień.

### 3.2 Mapowanie etapów lejka CRM

W Events Managerze skonfiguruj etapy lejka CRM (*CRM lead events* /
*Ustawienia zdarzeń CRM*). Nazwy zdarzeń, które tam podasz, **muszą być
identyczne** z tymi wpisanymi w CRM (krok 4.3). Domyślnie proponujemy:

| Etap w CRM | Zdarzenie w Meta |
|---|---|
| Kontakt | `Qualified` |
| Wygrane | `Converted` |
| Przegrane | `Disqualified` |

### 3.3 Kampania z optymalizacją pod jakość

**To jest krok, bez którego cała reszta nie zmieni wyników.** Samo wysyłanie
zdarzeń nie przełącza optymalizacji istniejących kampanii.

1. Ads Manager → nowa kampania **Leady**.
2. Na poziomie zestawu reklam: miejsce konwersji **Formularze błyskawiczne**,
   optymalizacja **Leady konwertujące** (*Conversion leads*).
3. Wybierz etap lejka, pod który Meta ma optymalizować (np. `Converted`).
4. Uprawnienia: konto musi mieć połączony CRM/zbiór danych ze zdarzeniami
   z kroku 3.2.

> Faza uczenia potrzebuje mniej więcej **15–20 zdarzeń wybranego etapu
> tygodniowo na zestaw reklam**. Przy mniejszym wolumenie mapuj optymalizację
> na wcześniejszy etap (np. `Qualified` zamiast `Converted`).

> **Limit 90 dni:** Meta przyjmuje zdarzenia CRM dla leadów nie starszych niż
> 90 dni od wypełnienia formularza. Jeśli Wasz cykl sprzedaży bywa dłuższy,
> optymalizujcie pod wcześniejszy etap — CRM sam pomija leady spoza okna
> i odnotowuje to w logu.

## 4. Co zrobić w CRM

Ustawienia → **Facebook Lead Ads**.

### 4.1 Odbieranie leadów

Skopiuj **adres endpointu** (`https://<twoja-domena>/api/leads/facebook`).
Sekcja pokazuje też, czy serwer widzi `FB_LEADS_KEY`.

### 4.2 Conversions API

Wklej **Dataset ID** i **token** z kroku 3.1, zaznacz *Wysyłaj zdarzenia
jakości leada do Meta* i kliknij **Zapisz**, a potem **Sprawdź połączenie**
(pyta Graph API o nazwę zbioru danych — nie wysyła żadnego zdarzenia).

Na czas testów możesz wpisać **kod zdarzeń testowych** (Events Manager →
Testuj zdarzenia) — zdarzenia będą wtedy widoczne w podglądzie na żywo.

Pozostawienie pól pustych = użycie globalnej konfiguracji Meta z ustawień
formularzy.

### 4.3 Etapy lejka → zdarzenia

Wpisz nazwy zdarzeń przy etapach i zaznacz *Aktywne*. Puste pole = etap nic
nie raportuje. Etap oznaczony jako wygrany dokłada do zdarzenia **wartość
deala** (`value` + `currency: PLN`), żeby Meta mogła optymalizować pod
przychód, a nie samą liczbę konwersji.

### 4.4 Mapowanie pól formularza

Formularze pojawiają się na liście **automatycznie po pierwszym leadzie** —
razem z listą swoich pól. Pola standardowe Facebooka (`full_name`, `email`,
`phone_number`, `company_name`) są rozpoznawane bez konfiguracji; pytania
własne wskaż ręcznie (pole deala albo właściwość własna).

Odpowiedzi bez mapowania **nie giną** — trafiają na oś czasu leada i do
`props.fb_answers`.

## 5. Scenariusz w Make.com

Trzy moduły:

**1. Facebook Lead Ads → Watch Leads**
Połącz konto (uprawnienia `leads_retrieval`, `pages_manage_ads`, `pages_show_list`),
wskaż stronę i formularz. Moduł sam pobiera treść odpowiedzi z Graph API.

**2. HTTP → Make a request**

| Pole | Wartość |
|---|---|
| URL | `https://<twoja-domena>/api/leads/facebook` |
| Method | `POST` |
| Headers | `X-API-Key` : `<FB_LEADS_KEY>` |
| Body type | `Raw` → `JSON (application/json)` |

Treść (mapuj wartości z modułu 1):

```json
{
  "leadgen_id": "{{1.id}}",
  "form_id": "{{1.form_id}}",
  "form_name": "{{1.form_name}}",
  "page_id": "{{1.page_id}}",
  "ad_id": "{{1.ad_id}}",
  "adset_id": "{{1.adset_id}}",
  "campaign_id": "{{1.campaign_id}}",
  "platform": "{{1.platform}}",
  "is_organic": "{{1.is_organic}}",
  "created_time": "{{1.created_time}}",
  "field_data": {{1.field_data}}
}
```

`field_data` może być tablicą `[{ name, values }]` (surowy kształt z Graph API)
albo płaskim obiektem `{ "email": "…" }` — endpoint przyjmuje oba, więc sposób
mapowania w Make nie ma znaczenia.

Wystarczy sam `leadgen_id` + `field_data`; reszta pól to atrybucja kampanii
(przydatna w raportach, nieobowiązkowa).

**3. Error handler** (prawy klik na moduł HTTP → *Add error handler* → **Break**)
Endpoint jest idempotentny — ponowienie tego samego leada **nigdy** nie utworzy
duplikatu, więc retry jest bezpieczny.

### Odpowiedź endpointu

```json
{ "ok": true, "received": 1, "failed": 0,
  "results": [{ "lead_id": "123", "status": "created", "deal_id": "uuid" }] }
```

`status`: `created` (nowy deal) · `updated` (lead już był — odświeżono metadane
kampanii) · `skipped` (formularz wyłączony w CRM) · `error`.

Kody HTTP: `200` wszystko OK · `207` część partii padła · `401` zły klucz ·
`503` brak `FB_LEADS_KEY` na serwerze.

## 6. Ponawianie wysyłek do Meta

Zmiana etapu nie czeka na odpowiedź Graph API. Gdy wysyłka się nie powiedzie,
wiersz zostaje w `meta_lead_events` z `ok = false`, a job
`/api/cron/meta-lead-events` ponawia go co godzinę
(`.github/workflows/meta-lead-events.yml`, sekrety `DEPLOY_URL` i `CRON_SECRET`
w ustawieniach repozytorium — te same, co dla pozostałych jobów).

Deduplikacja po stronie Meta (`event_id = "<lead_id>:<nazwa_zdarzenia>"`)
sprawia, że ponowienie jest bezpieczne nawet gdy poprzednia próba jednak
doszła.

## 7. Test end-to-end

1. **Meta** → Events Manager → *Testuj zdarzenia*, skopiuj kod testowy do CRM
   (Ustawienia → Facebook Lead Ads).
2. **Meta** → [Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing)
   → wybierz stronę i formularz → *Create lead*.
3. **Make** → scenariusz powinien wystartować; sprawdź, że moduł HTTP zwrócił
   `200` i `"status": "created"`.
4. **CRM** → Leady: nowy lead ze źródłem „Facebook Lead Ads", z odpowiedziami
   na osi czasu. Ustawienia → Facebook Lead Ads: formularz na liście z polami
   do zmapowania.
5. **CRM** → otwórz leada, przesuń na etap z aktywnym mapowaniem (np. Kontakt).
6. **CRM** → Ustawienia → Facebook Lead Ads → sekcja *Ostatnie zdarzenia*:
   powinien pojawić się wpis `wysłane ✓`.
7. **Meta** → Events Manager → *Testuj zdarzenia*: zdarzenie `Qualified`
   ze źródłem `Selltic CRM`.
8. Ponów krok 2 z tym samym leadem — w CRM ma **nie** powstać drugi deal
   (`"status": "updated"`).

Po testach wyczyść pole *Kod zdarzeń testowych* w CRM — inaczej zdarzenia
produkcyjne będą trafiać wyłącznie do podglądu testowego.

## 8. Diagnostyka

| Objaw | Przyczyna |
|---|---|
| Make dostaje `503` | Brak `FB_LEADS_KEY` w Vercel albo brak redeployu po dodaniu |
| Make dostaje `401` | Nagłówek `X-API-Key` nie zgadza się z `FB_LEADS_KEY` |
| `"error": "Brak field_data"` | Moduł HTTP w Make nie mapuje odpowiedzi z modułu 1 |
| Lead w CRM bez telefonu/e-maila | Pytanie własne zamiast pola standardowego — zmapuj je (4.4) |
| Log pokazuje `błąd (400)` | Zwykle zły token, zły Dataset ID albo `lead_id` spoza tego konta |
| **Make: `(#100) Missing Permission`** | Konto połączone w Make nie ma dostępu do leadów strony. Wymagane: rola **administratora lub „Potencjalni klienci"** na stronie (Meta Business Suite → Ustawienia → Osoby) oraz zgody `leads_retrieval`, `pages_manage_ads`, `pages_show_list` przy połączeniu. Napraw rolę → w Make usuń i dodaj połączenie od nowa (istniejące nie dobierze zgód samo). |
| **Make: `(#100)` mimo poprawnej roli** | Strona nie jest przypisana do portfela biznesowego (Business Manager), albo lead jest starszy niż 90 dni — Graph API nie wyda jego treści |
| **CRM: `(#100) Missing Permission` przy „Sprawdź połączenie"** | Naprawione — test uderza teraz w endpoint zdarzeń, a nie w metadane zbioru danych. Jeśli błąd wraca, token nie należy do wskazanego Dataset ID |
| Cisza w Events Managerze, log pusty | Wyłączony przełącznik w 4.2 albo brak nazwy zdarzenia przy etapie (4.3) |
| Zdarzenie wysłane, ale niewidoczne | Ustawiony kod zdarzeń testowych → zdarzenia idą tylko do podglądu testowego |
