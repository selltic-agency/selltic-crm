// Test regresyjny parsowania rozbicia score. Uruchomienie (Node 22+):
//   node --experimental-strip-types lib/scoreBreakdown.test.ts
// Nie wymaga frameworka — używa wbudowanego node:assert.
import assert from "node:assert";
import { parseScoreBreakdown, formatBreakdownLine, formatBreakdownItem } from "./scoreBreakdown.ts";

// 1. Realny kształt z score_website(): { klucz: { punkty, opis } }.
const breakdown = {
  stan_strony: { punkty: 40, opis: "Brak strony/domeny" },
  opinie: { punkty: 12, opis: "≥ 15 opinii" },
  ocena: { punkty: 10, opis: "≥ 4.0 oceny" },
};
const parsed = parseScoreBreakdown(breakdown);
assert.strictEqual(parsed.items.length, 3, "3 pozycje");
assert.strictEqual(parsed.total, 62, "suma 62");
// Kolejność: stan_strony przed opinie przed ocena.
assert.strictEqual(parsed.items[0].label, "Brak strony/domeny");
assert.strictEqual(parsed.items[1].label, "≥ 15 opinii");
assert.strictEqual(formatBreakdownItem(parsed.items[0]), "Brak strony/domeny: +40 pkt");
assert.strictEqual(formatBreakdownLine(parsed, 62).endsWith("= 62/100"), true);

// 2. Nieznane klucze lądują na końcu, znane zachowują priorytet.
const mixed = {
  cos_nowego: { punkty: 3, opis: "Nowa reguła" },
  stan_strony: { punkty: 0, opis: "Jest strona i działa" },
};
const parsedMixed = parseScoreBreakdown(mixed);
assert.strictEqual(parsedMixed.items[0].label, "Jest strona i działa", "znany klucz pierwszy");
assert.strictEqual(formatBreakdownItem({ label: "x", points: 0 }), "x: 0 pkt", "zero bez plusa");

// 3. Fallback do starych props.score_reasons (lista stringów), gdy brak rozbicia.
const fb = parseScoreBreakdown(null, ["Brak strony WWW", "Mało opinii"]);
assert.strictEqual(fb.items.length, 2);
assert.strictEqual(fb.items[0].points, null);
assert.strictEqual(fb.total, null);

// 4. Puste/niepoprawne wejście = brak pozycji (bez wyjątku).
assert.strictEqual(parseScoreBreakdown(null).items.length, 0);
assert.strictEqual(parseScoreBreakdown(undefined).items.length, 0);
assert.strictEqual(parseScoreBreakdown("nonsense").items.length, 0);
assert.strictEqual(parseScoreBreakdown({ zly: { opis: "brak punktów" } }).items.length, 0);
assert.strictEqual(parseScoreBreakdown([]).items.length, 0);

// 5. formatBreakdownLine bez pozycji, ale ze score -> samo "N/100".
assert.strictEqual(formatBreakdownLine(parseScoreBreakdown(null), 55), "55/100");

console.log("scoreBreakdown: wszystkie asercje przeszły ✓");
