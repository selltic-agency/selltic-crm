// Test regresyjny normalizacji numerów do E.164 (moduł SMS). Uruchomienie:
//   node --experimental-strip-types lib/sms/e164.test.ts
import assert from "node:assert";
import { toE164, isE164 } from "../phone.ts";

// ── Domyślny kraj +48 gdy brak prefiksu; spacje/formatowanie usuwane ────────
assert.strictEqual(toE164("601 234 567"), "+48601234567", "PL bez prefiksu → +48, bez spacji");
assert.strictEqual(toE164("+48 601 234 567"), "+48601234567", "PL z prefiksem i spacjami");
assert.strictEqual(toE164("0048601234567"), "+48601234567", "00 → +");
assert.strictEqual(toE164("+48601234567"), "+48601234567", "już E.164");

// ── Numery niepoprawne → null ───────────────────────────────────────────────
assert.strictEqual(toE164(""), null, "pusty → null");
assert.strictEqual(toE164("123"), null, "za krótki → null");
assert.strictEqual(toE164("601 234 56"), null, "8 cyfr PL → null");
assert.strictEqual(toE164("100 234 567"), null, "błędny prefiks operatora PL → null");

// ── Inne kraje (łagodna reguła 6–12 cyfr) ───────────────────────────────────
assert.strictEqual(toE164("+49 151 12345678"), "+4915112345678", "DE poprawny");

// ── isE164 ──────────────────────────────────────────────────────────────────
assert.strictEqual(isE164("+48601234567"), true);
assert.strictEqual(isE164("+48 601 234 567"), false, "ze spacjami nie jest kanoniczne E.164");

console.log("e164.test.ts — OK");
