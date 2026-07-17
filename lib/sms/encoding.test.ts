// Test regresyjny kodowania i liczenia segmentów SMS. Uruchomienie:
//   node --experimental-strip-types lib/sms/encoding.test.ts
import assert from "node:assert";
import { isGsm7, segmentInfo, stripDiacritics } from "./encoding.ts";

// ── GSM-7 vs UCS-2 ──────────────────────────────────────────────────────────
assert.strictEqual(isGsm7("Hello world"), true, "ASCII = GSM-7");
assert.strictEqual(isGsm7("Czesc, jak tam?"), true, "ASCII bez diakrytyków = GSM-7");
assert.strictEqual(isGsm7("Cześć"), false, "polski znak wymusza UCS-2");

// ── Progi segmentów GSM-7 (160 / 153) ───────────────────────────────────────
const g1 = segmentInfo("a".repeat(160));
assert.strictEqual(g1.encoding, "gsm7");
assert.strictEqual(g1.segments, 1, "160 znaków = 1 segment");
const g2 = segmentInfo("a".repeat(161));
assert.strictEqual(g2.segments, 2, "161 znaków = 2 segmenty (153/segment)");
const g3 = segmentInfo("a".repeat(306));
assert.strictEqual(g3.segments, 2, "306 = 2 segmenty");
const g4 = segmentInfo("a".repeat(307));
assert.strictEqual(g4.segments, 3, "307 = 3 segmenty");

// ── Progi segmentów UCS-2 (70 / 67) ─────────────────────────────────────────
const u1 = segmentInfo("ą".repeat(70));
assert.strictEqual(u1.encoding, "ucs2");
assert.strictEqual(u1.segments, 1, "70 znaków UCS-2 = 1 segment");
const u2 = segmentInfo("ą".repeat(71));
assert.strictEqual(u2.segments, 2, "71 znaków UCS-2 = 2 segmenty (67/segment)");

// ── Znaki rozszerzeń GSM-7 kosztują 2 septety ───────────────────────────────
const ext = segmentInfo("€"); // w tablicy rozszerzeń
assert.strictEqual(ext.encoding, "gsm7", "€ jest w GSM-7 (rozszerzenia)");
assert.strictEqual(ext.length, 2, "€ = 2 septety");

// ── Transliteracja diakrytyków → ASCII (GSM-7) ──────────────────────────────
assert.strictEqual(stripDiacritics("Cześć, gęślą jaźń"), "Czesc, gesla jazn");
assert.strictEqual(isGsm7(stripDiacritics("Zażółć gęślą jaźń")), true, "po transliteracji = GSM-7");

console.log("encoding.test.ts — OK");
