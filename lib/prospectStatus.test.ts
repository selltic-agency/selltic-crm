// Test regresyjny mapowania statusów prospektu (ścieżka „przejścia statusu leada”).
// Uruchomienie: npm test
import assert from "node:assert";
import {
  toDisplayStatus,
  dbStatusForWrite,
  isCallable,
  isClosedBusiness,
  scoreLabel,
  scoreColor,
  notesFromProps,
  scoreReasons,
  initials,
  DISPLAY_STATUSES,
} from "./prospectStatus.ts";
import type { Prospect } from "./types.ts";

function makeProspect(over: Partial<Prospect> = {}): Prospect {
  return {
    id: "p1",
    owner: "o1",
    place_id: "pl1",
    name: "Klinika Zdrowie",
    phone: null,
    website: null,
    address: null,
    rating: null,
    review_count: null,
    business_status: "OPERATIONAL",
    industry: null,
    city: null,
    source: "google_maps_scraper",
    prospecting_status: "new",
    created_at: "2026-01-01T00:00:00Z",
    last_contact_attempt_at: null,
    note: null,
    website_status: null,
    website_last_checked_at: null,
    lead_score: null,
    lead_score_breakdown: null,
    converted_deal_id: null,
    archived_at: null,
    props: {},
    ...over,
  } as Prospect;
}

// ── toDisplayStatus: 4 stany UI + zbicie legacy/nieznanych do „no_answer” ────
assert.strictEqual(toDisplayStatus("new"), "new");
assert.strictEqual(toDisplayStatus("not_interested"), "not_interested");
assert.strictEqual(toDisplayStatus("converted"), "converted");
// Legacy z bazy (constraint wciąż dopuszcza) mapuje się na „no_answer”.
assert.strictEqual(toDisplayStatus("contact_attempted"), "no_answer");
// Każda nierozpoznana wartość również → „no_answer” (bezpieczny domyślny).
assert.strictEqual(toDisplayStatus("cokolwiek"), "no_answer");
assert.strictEqual(toDisplayStatus(""), "no_answer");

// ── dbStatusForWrite: status UI → wartość zapisywana w kolumnie ──────────────
assert.strictEqual(dbStatusForWrite("no_answer"), "contact_attempted");
assert.strictEqual(dbStatusForWrite("not_interested"), "not_interested");

// Zbiór statusów UI jest kompletny i w ustalonej kolejności.
assert.deepStrictEqual(DISPLAY_STATUSES, ["new", "no_answer", "not_interested", "converted"]);

// ── isClosedBusiness: firma inna niż OPERATIONAL jest „zamknięta” ────────────
assert.strictEqual(isClosedBusiness(makeProspect({ business_status: "OPERATIONAL" })), false);
assert.strictEqual(isClosedBusiness(makeProspect({ business_status: "CLOSED_PERMANENTLY" })), true);
assert.strictEqual(isClosedBusiness(makeProspect({ business_status: null })), false, "brak statusu ≠ zamknięta");

// ── isCallable: aktywny do dzwonienia tylko dla new/no_answer i działającej firmy
assert.strictEqual(isCallable(makeProspect({ prospecting_status: "new" })), true);
assert.strictEqual(isCallable(makeProspect({ prospecting_status: "contact_attempted" })), true, "no_answer wciąż dzwonimy");
assert.strictEqual(isCallable(makeProspect({ prospecting_status: "not_interested" })), false);
assert.strictEqual(isCallable(makeProspect({ prospecting_status: "converted" })), false);
// Firma zamknięta wypada z dzwonienia, nawet gdy status „new”.
assert.strictEqual(
  isCallable(makeProspect({ prospecting_status: "new", business_status: "CLOSED_PERMANENTLY" })),
  false
);

// ── scoreLabel / scoreColor: progi 70 / 35 ──────────────────────────────────
assert.strictEqual(scoreLabel(85), "wysoki");
assert.strictEqual(scoreLabel(70), "wysoki", "granica 70 = wysoki");
assert.strictEqual(scoreLabel(50), "średni");
assert.strictEqual(scoreLabel(35), "średni", "granica 35 = średni");
assert.strictEqual(scoreLabel(10), "niski");
assert.notStrictEqual(scoreColor(80), scoreColor(20), "różne progi → różne kolory");

// ── notesFromProps: bezpieczne parsowanie notatek z props.notes (jsonb) ──────
assert.deepStrictEqual(notesFromProps(null), []);
assert.deepStrictEqual(notesFromProps({}), []);
assert.deepStrictEqual(notesFromProps({ notes: "nie tablica" }), []);
const good = notesFromProps({ notes: [{ id: "1", body: "oddzwonić", created_at: "x" }, { bad: true }] });
assert.strictEqual(good.length, 1, "odfiltrowuje wpisy bez pola body");
assert.strictEqual(good[0].body, "oddzwonić");

// ── scoreReasons: tylko stringi z props.score_reasons ────────────────────────
assert.deepStrictEqual(scoreReasons({ score_reasons: ["brak strony", 5, "słabe opinie"] }), ["brak strony", "słabe opinie"]);
assert.deepStrictEqual(scoreReasons(null), []);

// ── initials: awatar firmy ──────────────────────────────────────────────────
assert.strictEqual(initials("Klinika Zdrowie"), "KZ");
assert.strictEqual(initials("Medic"), "ME", "jedno słowo → pierwsze dwa znaki");
assert.strictEqual(initials("   "), "?", "sama biel → znak zapytania");

console.log("prospectStatus.test.ts — OK");
