# Selltic — Forms + CRM (fundament)

Baza pod aplikację: panel admina (solo), kreator formularzy z routingiem,
publiczne formularze + embed, CRM (pipeline, properties, taski, powiadomienia),
analityka. Wszystko na Next.js (App Router) + Supabase + Vercel.

## Co jest w tym pakiecie
```
schema.sql                     ← wklej w Supabase SQL Editor i uruchom
.env.example                   ← skopiuj do .env.local i uzupełnij
middleware.ts                  ← w katalogu głównym projektu
lib/supabase/client.ts         ← klient przeglądarkowy
lib/supabase/server.ts         ← klient serwerowy (SSR) + admin (service role)
lib/supabase/middleware.ts     ← odświeżanie sesji + ochrona /admin
app/api/submit/route.ts        ← submission → kontakt → aktywność → mail
```

## Setup — krok po kroku

1. **Projekt Next.js** (jeśli zaczynasz od zera):
   ```bash
   npx create-next-app@latest selltic --ts --app --tailwind --eslint
   cd selltic
   npm install @supabase/ssr @supabase/supabase-js
   ```
   Skopiuj pliki z tego pakietu, zachowując strukturę katalogów.

2. **Supabase**: załóż projekt na supabase.com → SQL Editor → wklej `schema.sql` → Run.

3. **Zmienne**: skopiuj `.env.example` → `.env.local`, wklej klucze z Supabase
   (Project Settings → API). `SUPABASE_SERVICE_ROLE_KEY` to sekret — nigdy do kodu klienta.

4. **Twój admin**: Supabase → Authentication → Users → Add user (email + hasło).
   To jedyne konto, którym się logujesz. Klienci nigdy się nie logują.

5. **Ustawienia**: dodaj jeden wiersz w `app_settings`, żeby maile działały:
   ```sql
   insert into app_settings (owner, email_new_lead, notify_email)
   values ('<TWÓJ_USER_ID>', true, 'dominik@selltic-agency.pl');
   ```
   (`USER_ID` znajdziesz przy userze w Authentication.)

6. **Maile** (opcjonalnie teraz): konto na resend.com, zweryfikuj domenę,
   wklej `RESEND_API_KEY`. Bez tego wszystko działa, tylko bez powiadomień.

7. `npm run dev` → wejdź na `/admin` (przekieruje na `/login`, bo brak sesji).

## Dalej — kolejność budowy

Fundament gotowy. Reszta dokłada się warstwami, każda samodzielna:

- **Faza 1 — Auth + kreator do bazy.** Strona `/login` (Supabase Auth UI lub własny
  formularz), `/admin` z listą formularzy, `/admin/[id]` = kreator z prototypu
  zapisujący `schema` (debounce) i publikujący (`published = schema`, `status='published'`).
- **Faza 2 — Renderer + publiczna strona.** Wspólny `<Renderer form={...} />`
  (z prototypu FlowForm), strona `/f/[slug]` czytająca `published`, wysyłka do `/api/submit`.
  Tryb `?embed=1` (bez nagłówka) + auto-wysokość przez `postMessage`.
- **Faza 3 — CRM.** Widoki z prototypu CrmApp podpięte pod tabele: pipeline,
  karta kontaktu (properties z `property_defs`, oś czasu z `activities`), taski.
- **Faza 4 — Analityka + przypomnienia.** Wykresy (recharts) z zapytań agregujących;
  Vercel Cron → `/api/cron/reminders` dla terminów zadań.

Powiedz, którą fazę wystawiam jako kolejne pliki — najsensowniej Faza 1
(login + lista + kreator zapisujący do Supabase), bo odblokowuje całą resztę.
# selltic-crm
