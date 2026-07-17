// Test regresyjny podstawiania zmiennych w treści SMS. Uruchomienie:
//   node --experimental-strip-types lib/sms/templates.test.ts
import assert from "node:assert";
import { renderSmsTemplate, usedSmsVariables } from "./templates.ts";

// ── strict: braki zgłaszane w `missing` (blokują wysyłkę manualną) ──────────
const strict = renderSmsTemplate("Cześć {{first_name}}, spotkanie {{meeting_date}}", { first_name: "Anna" }, "strict");
assert.deepStrictEqual(strict.missing, ["meeting_date"], "brakująca zmienna raportowana");
assert.ok(!strict.text.includes("{{"), "nigdy dosłownych nawiasów");

// ── graceful: brak first_name NIE tworzy „Cześć ," ──────────────────────────
const g = renderSmsTemplate("Cześć {{first_name}}, dziękujemy!", {}, "graceful");
assert.strictEqual(g.text, "Cześć, dziękujemy!", "artefakt spacji przed przecinkiem sprzątnięty");

// ── graceful: podstawienie normalnych wartości ──────────────────────────────
const g2 = renderSmsTemplate("Cześć {{first_name}} z {{company}}", { first_name: "Anna", company: "Róża" }, "graceful");
assert.strictEqual(g2.text, "Cześć Anna z Róża");

// ── żadnych literalnych nawiasów przy nieznanej zmiennej ────────────────────
const g3 = renderSmsTemplate("Kod: {{unknown_var}}!", {}, "graceful");
assert.strictEqual(g3.text, "Kod:!", "nieznana zmienna → pusto (spacja przed ! sprzątnięta), bez nawiasów");
assert.ok(!g3.text.includes("{{"), "brak literalnych nawiasów");

// ── usedSmsVariables ────────────────────────────────────────────────────────
assert.deepStrictEqual(usedSmsVariables("{{a}} {{b}} {{a}}"), ["a", "b"], "unikalne klucze");

console.log("templates.test.ts — OK");
