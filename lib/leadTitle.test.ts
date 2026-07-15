// Testy §7a — rozwiązywanie szablonu tytułu leadu (degradacja placeholderów).
import assert from "node:assert";
import { resolveLeadTitle, leadTitleTokens } from "./leadTitle.ts";
import type { FormField } from "./forms.ts";

const fields: FormField[] = [
  { id: "f1", type: "short_text", question: "Imię" },
  { id: "f2", type: "email", question: "E-mail" },
];

// Podstawowe podstawienie pola + tytułu formularza.
assert.strictEqual(
  resolveLeadTitle("{{field:f1}} — {{form:title}}", {
    fields,
    answers: { f1: "Anna" },
    formTitle: "Wycena",
  }),
  "Anna — Wycena"
);

// Nierozwiązany placeholder (puste pytanie) — nie renderuje surowego tokena,
// czyści osierocony separator.
assert.strictEqual(
  resolveLeadTitle("{{field:f1}} — {{form:title}}", {
    fields,
    answers: {},
    formTitle: "Wycena",
  }),
  "Wycena"
);

// Usunięte pole (brak w fields) → puste, fallback gdy nic nie zostaje.
assert.strictEqual(
  resolveLeadTitle("{{field:usuniete}}", { fields, answers: {}, fallback: "Nowy lead" }),
  "Nowy lead"
);

// Pusty szablon → fallback.
assert.strictEqual(resolveLeadTitle("", { fields, answers: {} }), "Nowy lead");

// Tablica odpowiedzi (multi) → łączona przecinkami.
assert.strictEqual(
  resolveLeadTitle("{{field:f1}}", { fields, answers: { f1: ["A", "B"] } }),
  "A, B"
);

// Nigdy nie zostaje surowy token.
const out = resolveLeadTitle("x {{field:zzz}} y", { fields, answers: {} });
assert.ok(!out.includes("{{"), "brak surowych tokenów");

// Lista tokenów zawiera pola z treścią + tokeny formularza.
const tokens = leadTitleTokens(fields);
assert.ok(tokens.some((t) => t.token === "{{field:f1}}"));
assert.ok(tokens.some((t) => t.token === "{{form:title}}"));

console.log("leadTitle.test.ts — OK");
