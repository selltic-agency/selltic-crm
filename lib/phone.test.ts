// Test regresyjny walidacji telefonu (PL) i normalizacji cyfr. Uruchomienie:
//   node --experimental-strip-types lib/phone.test.ts
import assert from "node:assert";
import { digitsOnly, phoneLocalError, formatPhoneValue, splitPhone } from "./phone.ts";

// ── digitsOnly ────────────────────────────────────────────────────────────
assert.strictEqual(digitsOnly("+48 500 123 456"), "48500123456");
assert.strictEqual(digitsOnly("(500) 123-456"), "500123456");
assert.strictEqual(digitsOnly(""), "");

// ── PL: dokładnie 9 cyfr + poprawny prefiks operatora ──────────────────────
assert.strictEqual(phoneLocalError("+48", "500 123 456"), null, "50x poprawny");
assert.strictEqual(phoneLocalError("+48", "660123456"), null, "66x poprawny");
assert.strictEqual(phoneLocalError("+48", "451234567"), null, "45x poprawny");
assert.strictEqual(phoneLocalError("+48", "881234567"), null, "88x poprawny");

// Zła liczba cyfr.
assert.notStrictEqual(phoneLocalError("+48", "50012345"), null, "8 cyfr = błąd");
assert.notStrictEqual(phoneLocalError("+48", "5001234567"), null, "10 cyfr = błąd");

// Zły prefiks operatora (10x, 20x, 61x nie są na liście).
assert.notStrictEqual(phoneLocalError("+48", "100123456"), null, "10x = błąd");
assert.notStrictEqual(phoneLocalError("+48", "610123456"), null, "61x = błąd");
assert.notStrictEqual(phoneLocalError("+48", "999123456"), null, "99x = błąd");

// ── Inne kraje: łagodna reguła 6–12 cyfr ───────────────────────────────────
assert.strictEqual(phoneLocalError("+49", "15112345678"), null, "DE 11 cyfr OK");
assert.strictEqual(phoneLocalError("+49", "100123456"), null, "DE dowolny prefiks OK");
assert.notStrictEqual(phoneLocalError("+49", "12345"), null, "DE 5 cyfr = błąd");

// ── formatPhoneValue: spójny format PL ─────────────────────────────────────
assert.strictEqual(formatPhoneValue("+48", "500123456"), "+48 500 123 456");
assert.strictEqual(formatPhoneValue("+48", "500 123 456"), "+48 500 123 456");
assert.strictEqual(formatPhoneValue("+49", "15112345678"), "+49 15112345678");
assert.strictEqual(formatPhoneValue("+48", ""), "");

// ── splitPhone: prefiks + część lokalna ────────────────────────────────────
assert.deepStrictEqual(splitPhone("+48 500 123 456", "+48"), { prefix: "+48", local: "500 123 456" });
assert.deepStrictEqual(splitPhone("500123456", "+48"), { prefix: "+48", local: "500123456" });

console.log("phone.test.ts — OK");
