// lib/scraperMessages.ts — tłumaczenie surowych błędów scrapera na czytelne
// komunikaty po polsku z sugestią następnego kroku. Backend (Cloud Run)
// zapisuje techniczny error_message do scrape_jobs.error_message; tutaj
// mapujemy najczęstsze przyczyny na język zrozumiały dla użytkownika.

export type HumanMessage = {
  text: string; // zwięzły, czytelny komunikat + sugestia następnego kroku
  hint?: string; // opcjonalna dodatkowa wskazówka
};

// Zamienia error_message zadania na czytelny komunikat po polsku.
export function humanizeScrapeError(raw: string | null | undefined): HumanMessage {
  const msg = (raw ?? "").trim();
  const lower = msg.toLowerCase();

  if (!msg) {
    return { text: "Nieznany błąd zadania. Spróbuj ponownie." };
  }

  // Brak klucza API (backend rzuca "Brak klucza Google Places API ...").
  if (lower.includes("brak klucza") || lower.includes("api_key") || lower.includes("missing api key")) {
    return { text: "Brak klucza API — sprawdź go w Ustawieniach." };
  }

  // Klucz odrzucony / brak uprawnień / rozliczeń.
  if (lower.includes("request_denied")) {
    return { text: "Błąd klucza API — sprawdź uprawnienia i rozliczenia w Google Cloud." };
  }

  // Przekroczony limit zapytań.
  if (lower.includes("over_query_limit") || lower.includes("quota")) {
    return { text: "Przekroczono limit zapytań Google — odczekaj chwilę lub sprawdź limity w Google Cloud." };
  }

  // Nieprawidłowe zapytanie do API.
  if (lower.includes("invalid_request")) {
    return { text: "Nieprawidłowe zapytanie do Google — sprawdź słowo kluczowe i lokalizację." };
  }

  // Watchdog CRM: zadanie utknęło i zostało ubite po limicie czasu (patrz
  // /api/scraper/reap-stale). Skracamy do zwięzłej, akcjonowalnej treści —
  // pełny komunikat i tak jest dostępny w rozwijanych „Szczegółach”.
  if (lower.includes("limit czasu") || lower.includes("przekroczył")) {
    return {
      text:
        "Zadanie przekroczyło limit czasu — backend scrapera nie odebrał zlecenia lub został uśpiony. " +
        "Uruchom usługę z „CPU always allocated” / min-instances ≥ 1 i spróbuj ponownie.",
    };
  }

  // Problemy z połączeniem sieciowym / timeout.
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("connection") ||
    lower.includes("network")
  ) {
    return { text: "Problem z połączeniem podczas scrapowania — spróbuj ponownie za chwilę." };
  }

  // Fallback: pokaż surowy komunikat (pierwsza linia, bez stack trace). Nie
  // przycinamy sztywno do N znaków — UI zawija tekst i pokazuje całość, a raw
  // komunikat jest też w „Szczegółach”. Ograniczamy tylko patologicznie długie
  // jednolinijkowce, by nie zalać widoku.
  const firstLine = msg.split("\n")[0].slice(0, 400);
  return { text: `Błąd scrapera: ${firstLine}` };
}

// Komunikat dla zadania zakończonego bez wyników (status done, 0 leadów).
export const ZERO_RESULTS_MESSAGE =
  "Brak wyników dla tej kombinacji — spróbuj innej lokalizacji lub słowa kluczowego.";

function pluralLeady(n: number): string {
  return n === 1 ? "lead" : "leadów";
}

// Rozbicie „znaleziono” na NOWE vs „już w bazie”. Backend liczy results_count
// jako liczbę przetworzonych wyników API; new_count/existing_count dzielą ją na
// leady faktycznie dodane i te tylko odświeżone (ten sam place_id znaleziony
// wcześniej — częste przy bliskoznacznych słowach kluczowych). Świadomie
// unikamy słowa „duplikaty”, żeby nie mylić z zakładką „Duplikaty” (kolizje
// przy przenoszeniu do Prospectingu — tam duplikat wymaga decyzji; tu nie).
//
// - existing === 0  → „20 leadów” (wszystko nowe, brak szumu).
// - existing > 0    → „20 (12 nowych, 8 już w bazie)”.
// - dane niespójne (stare zadania sprzed migracji: new+existing ≠ total) →
//   sam total, bez rozbicia.
export function formatFound(total: number, newCount = 0, existingCount = 0): string {
  const n = Math.max(0, total || 0);
  const nw = Math.max(0, newCount || 0);
  const ex = Math.max(0, existingCount || 0);
  const consistent = nw + ex === n && n > 0;
  if (consistent && ex > 0) {
    return `${n} (${nw} ${nw === 1 ? "nowy" : "nowych"}, ${ex} już w bazie)`;
  }
  return `${n} ${pluralLeady(n)}`;
}
