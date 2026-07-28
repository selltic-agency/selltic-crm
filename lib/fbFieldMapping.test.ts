// Testy mapowania leadów z formularzy błyskawicznych Facebooka.
import assert from "node:assert";
import {
  answersSummary,
  mapFbAnswers,
  normalizeFieldData,
  parseFbCreatedTime,
  parseFbLeadPayload,
} from "./fbFieldMapping.ts";

// ── normalizeFieldData: oba kształty payloadu ───────────────────────────────
// Surowy Graph API / webhook: tablica { name, values }.
assert.deepStrictEqual(
  normalizeFieldData([
    { name: "email", values: ["JAN@FIRMA.PL"] },
    { name: "phone_number", values: ["+48512345678"] },
    { name: "usluga", values: ["Strona WWW", "SEO"] },
  ]),
  { email: "JAN@FIRMA.PL", phone_number: "+48512345678", usluga: "Strona WWW, SEO" }
);

// Moduł Make po zmapowaniu: płaski obiekt.
assert.deepStrictEqual(
  normalizeFieldData({ email: " jan@firma.pl ", full_name: "Jan Kowalski", puste: null }),
  { email: "jan@firma.pl", full_name: "Jan Kowalski" }
);

assert.deepStrictEqual(normalizeFieldData(null), {});

// ── mapFbAnswers: pola standardowe bez konfiguracji ─────────────────────────
const std = mapFbAnswers({
  full_name: "Jan Kowalski",
  email: "JAN@FIRMA.PL",
  phone_number: "+48 512 345 678",
  company_name: "Firma sp. z o.o.",
});
assert.strictEqual(std.name, "Jan Kowalski");
assert.strictEqual(std.email, "jan@firma.pl"); // e-mail zawsze lowercase
assert.strictEqual(std.phone, "+48 512 345 678");
assert.strictEqual(std.company, "Firma sp. z o.o.");
assert.deepStrictEqual(std.unmapped, {});

// Imię i nazwisko w osobnych polach → sklejone w jedno.
assert.strictEqual(mapFbAnswers({ first_name: "Jan", last_name: "Kowalski" }).name, "Jan Kowalski");

// `full_name` ma pierwszeństwo nad sklejaniem.
assert.strictEqual(
  mapFbAnswers({ full_name: "Anna Nowak", first_name: "Jan", last_name: "Kowalski" }).name,
  "Anna Nowak"
);

// ── mapFbAnswers: pytania własne ────────────────────────────────────────────
// Bez mapowania pytanie własne ląduje w `unmapped` (nie ginie, ale nie zaśmieca props).
const raw = mapFbAnswers({ jaka_usluga: "Strona WWW", budzet: "5000" });
assert.deepStrictEqual(raw.unmapped, { jaka_usluga: "Strona WWW", budzet: "5000" });
assert.deepStrictEqual(raw.props, {});

// Z mapowaniem: właściwość własna + wartość deala + pominięcie.
const mapped = mapFbAnswers(
  { jaka_usluga: "Strona WWW", budzet: "5 000,50", zgoda: "true" },
  { jaka_usluga: "prop:usluga", budzet: "value", zgoda: "ignore" }
);
assert.deepStrictEqual(mapped.props, { usluga: "Strona WWW" });
assert.strictEqual(mapped.value, 5000.5); // spacje i przecinek dziesiętny
assert.deepStrictEqual(mapped.unmapped, {});

// Mapowanie własne wygrywa z domyślnym.
assert.deepStrictEqual(
  mapFbAnswers({ email: "jan@firma.pl" }, { email: "prop:kontakt_email" }).props,
  { kontakt_email: "jan@firma.pl" }
);

// Puste odpowiedzi nie tworzą pustych właściwości.
assert.deepStrictEqual(mapFbAnswers({ jaka_usluga: "" }, { jaka_usluga: "prop:usluga" }).props, {});

// ── parseFbCreatedTime ──────────────────────────────────────────────────────
assert.strictEqual(parseFbCreatedTime("2026-07-28T09:12:00+0000"), "2026-07-28T09:12:00.000Z");
assert.strictEqual(parseFbCreatedTime(1785229200), "2026-07-28T09:00:00.000Z");
assert.strictEqual(parseFbCreatedTime("1785229200"), "2026-07-28T09:00:00.000Z");
assert.strictEqual(parseFbCreatedTime(""), null);
assert.strictEqual(parseFbCreatedTime("nie-data"), null);

// ── parseFbLeadPayload ──────────────────────────────────────────────────────
const payload = parseFbLeadPayload({
  leadgen_id: "1234567890",
  form_id: "555",
  form_name: "Wycena — Wrocław",
  page_id: "111",
  ad_id: "222",
  adset_id: "333",
  campaign_id: "444",
  platform: "ig",
  is_organic: false,
  created_time: "2026-07-28T09:12:00+0000",
  field_data: [{ name: "email", values: ["jan@firma.pl"] }],
});
assert.ok(payload);
assert.strictEqual(payload.leadId, "1234567890");
assert.strictEqual(payload.formId, "555");
assert.strictEqual(payload.campaignId, "444");
assert.strictEqual(payload.platform, "ig");
assert.strictEqual(payload.isOrganic, false);
assert.deepStrictEqual(payload.answers, { email: "jan@firma.pl" });

// Aliasy nazw (scenariusz w Make bywa mapowany różnie).
assert.strictEqual(parseFbLeadPayload({ id: "77", fields: { email: "a@b.pl" } })?.leadId, "77");

// Bez identyfikatora leada payload jest odrzucany — bez niego nie da się
// odesłać sygnału jakości do Meta.
assert.strictEqual(parseFbLeadPayload({ form_id: "555" }), null);

// ── answersSummary ──────────────────────────────────────────────────────────
assert.strictEqual(
  answersSummary({ jaka_usluga: "Strona WWW", budzet: "", email: "jan@firma.pl" }),
  "Jaka usluga: Strona WWW\nEmail: jan@firma.pl"
);

console.log("fbFieldMapping.test.ts — OK");
