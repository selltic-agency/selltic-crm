// Test regresyjny renderowania szablonów e-mail (ścieżka „wysyłka e-mail”).
// Uruchomienie: npm test  (lub node --experimental-strip-types … ten plik).
import assert from "node:assert";
import {
  renderText,
  renderHtml,
  usedPlaceholders,
  dealFieldValues,
  SAMPLE_VALUES,
} from "./emailTemplates.ts";
import type { Deal } from "./types.ts";

// Minimalny deal do testów pól dynamicznych.
function makeDeal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    owner: "o1",
    name: "Anna Kowalska",
    email: "anna@example.com",
    phone: "600 100 200",
    company: "Kwiaciarnia Róża",
    props: {},
    stage: "new",
    value: 0,
    source: null,
    form_id: null,
    assignee: null,
    opened_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Deal;
}

// ── renderText: podstawianie placeholderów w temacie (bez escapowania) ──────
assert.strictEqual(renderText("Cześć {{first_name}}", { first_name: "Anna" }), "Cześć Anna");
assert.strictEqual(renderText("{{ first_name }}", { first_name: "Anna" }), "Anna", "spacje w {{ }} tolerowane");
assert.strictEqual(renderText("{{FIRST_NAME}}", { first_name: "Anna" }), "Anna", "klucz case-insensitive");
assert.strictEqual(renderText("Brak: {{unknown}}", {}), "Brak: ", "nieznane pole → pusty string");
assert.strictEqual(renderText("", { a: "x" }), "", "pusty szablon → pusty wynik");
assert.strictEqual(renderText("bez pól", {}), "bez pól");

// ── renderHtml: podstawianie w treści HTML z escapowaniem wartości leada ─────
assert.strictEqual(renderHtml("<b>{{name}}</b>", { name: "Anna" }), "<b>Anna</b>");
assert.strictEqual(
  renderHtml("{{name}}", { name: 'A<b>x & "y"' }),
  "A&lt;b&gt;x &amp; &quot;y&quot;",
  "znaki specjalne w danych leada są escapowane (ochrona przed wstrzyknięciem HTML)"
);
// Sam szablon (HTML autora) NIE jest escapowany — tylko wartości.
assert.strictEqual(renderHtml("<a href='x'>{{name}}</a>", { name: "Ala" }), "<a href='x'>Ala</a>");

// ── usedPlaceholders: unikalne klucze, znormalizowane do lower-case ─────────
assert.deepStrictEqual(usedPlaceholders("{{a}} {{ B }} {{a}}"), ["a", "b"]);
assert.deepStrictEqual(usedPlaceholders("nic tu nie ma"), []);

// ── dealFieldValues: mapowanie deala + heurystyka imię/nazwisko ─────────────
const v = dealFieldValues(makeDeal());
assert.strictEqual(v.first_name, "Anna");
assert.strictEqual(v.last_name, "Kowalska");
assert.strictEqual(v.company, "Kwiaciarnia Róża");
assert.strictEqual(v.email, "anna@example.com");

// Jednoczłonowa nazwa → całość jako imię, nazwisko puste.
const v1 = dealFieldValues(makeDeal({ name: "Anna" }));
assert.strictEqual(v1.first_name, "Anna");
assert.strictEqual(v1.last_name, "");

// Nazwa wieloczłonowa → pierwsze słowo imię, reszta nazwisko.
const v3 = dealFieldValues(makeDeal({ name: "Jan Maria Rokita" }));
assert.strictEqual(v3.first_name, "Jan");
assert.strictEqual(v3.last_name, "Maria Rokita");

// Brak nazwy → puste pola (bez wyjątku).
const vEmpty = dealFieldValues(makeDeal({ name: null }));
assert.strictEqual(vEmpty.first_name, "");
assert.strictEqual(vEmpty.last_name, "");
assert.strictEqual(vEmpty.name, "");

// Null w polach opcjonalnych → pusty string (nie „null”).
const vNulls = dealFieldValues(makeDeal({ email: null, phone: null, company: null }));
assert.strictEqual(vNulls.email, "");
assert.strictEqual(vNulls.phone, "");
assert.strictEqual(vNulls.company, "");

// ── SAMPLE_VALUES: komplet przykładów do podglądu edytora ───────────────────
assert.strictEqual(SAMPLE_VALUES.first_name, "Anna");
assert.ok(Object.keys(SAMPLE_VALUES).length >= 10, "przykłady dla wszystkich pól");

// Pełny render złożonego szablonu (temat + treść) na przykładowych danych.
assert.strictEqual(
  renderText("Oferta dla {{company}}", SAMPLE_VALUES),
  "Oferta dla Kwiaciarnia Róża"
);

console.log("emailTemplates.test.ts — OK");
