// lib/scraperMessages.test.ts — weryfikacja rozbicia „znaleziono” na NOWE vs
// „już w bazie” (raportowanie deduplikacji na poziomie zadania scrapowania).
// Uruchom: npx tsx lib/scraperMessages.test.ts
import assert from "node:assert";
import { formatFound } from "./scraperMessages.ts";

let passed = 0;
function eq(name: string, got: string, want: string) {
  assert.strictEqual(got, want, `FAIL: ${name} → "${got}" ≠ "${want}"`);
  passed++;
}

// Scenariusz z zgłoszenia: dwa bliskoznaczne zapytania po ~20 wyników, duża
// część to te same firmy → drugie zadanie w większości „już w bazie”.
eq("overlap: 20 = 12 nowych + 8 już w bazie", formatFound(20, 12, 8), "20 (12 nowych, 8 już w bazie)");

// Wszystko nowe (brak nakładania) → bez szumu, sam licznik.
eq("wszystko nowe", formatFound(20, 20, 0), "20 leadów");

// existing == total (drugie identyczne zapytanie — nic nowego).
eq("wszystko już w bazie", formatFound(20, 0, 20), "20 (0 nowych, 20 już w bazie)");

// Formy liczby pojedynczej.
eq("jeden nowy", formatFound(1, 1, 0), "1 lead");
eq("1 nowy + reszta w bazie", formatFound(5, 1, 4), "5 (1 nowy, 4 już w bazie)");

// Zero wyników.
eq("zero", formatFound(0, 0, 0), "0 leadów");

// Wstecz-kompatybilność: stare zadania sprzed migracji mają new/existing = 0,
// ale results_count > 0 → pokaż sam total (dane niespójne, brak rozbicia).
eq("legacy (brak rozbicia)", formatFound(20, 0, 0), "20 leadów");

// Dane niespójne (suma ≠ total) → też sam total, bez rozbicia.
eq("niespójne sumy", formatFound(20, 5, 3), "20 leadów");

console.log(`✓ Wszystkie ${passed} asercji formatFound przeszły.`);
